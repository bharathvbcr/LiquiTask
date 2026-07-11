package notify

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const SuppressionWindow = 62 * time.Second

// Config holds remote push credentials synced from the LiquiTask app.
type Config struct {
	Enabled          bool   `json:"enabled"`
	Provider         string `json:"provider"` // pushover | webhook | none
	PushoverUserKey  string `json:"pushoverUserKey,omitempty"`
	PushoverAPIToken string `json:"pushoverApiToken,omitempty"`
	WebhookURL       string `json:"webhookUrl,omitempty"`
}

// Dispatcher sends Pushover / webhook notifications with dedupe suppression.
type Dispatcher struct {
	mu   sync.Mutex
	cfg  Config
	last map[string]time.Time
}

func NewDispatcher() *Dispatcher {
	return &Dispatcher{last: make(map[string]time.Time)}
}

func (d *Dispatcher) SetConfig(cfg Config) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.cfg = cfg
}

func (d *Dispatcher) Config() Config {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.cfg
}

// MaybeSend delivers a notification when enabled and outside the suppression window.
func (d *Dispatcher) MaybeSend(kind, title, body, dedupeKey string) {
	d.mu.Lock()
	cfg := d.cfg
	if !cfg.Enabled || cfg.Provider == "" || cfg.Provider == "none" {
		d.mu.Unlock()
		return
	}
	key := strings.TrimSpace(dedupeKey)
	if key == "" {
		key = kind
	}
	now := time.Now()
	if last, ok := d.last[key]; ok && now.Sub(last) < SuppressionWindow {
		d.mu.Unlock()
		return
	}
	d.last[key] = now
	d.mu.Unlock()

	switch cfg.Provider {
	case "pushover":
		if cfg.PushoverUserKey == "" || cfg.PushoverAPIToken == "" {
			return
		}
		_ = SendPushover(cfg.PushoverUserKey, cfg.PushoverAPIToken, title, body)
	case "webhook":
		if cfg.WebhookURL == "" {
			return
		}
		_ = SendWebhook(cfg.WebhookURL, kind, title, body)
	}
}

// SendPushover posts to the Pushover messages API.
func SendPushover(userKey, apiToken, title, message string) error {
	form := url.Values{}
	form.Set("token", apiToken)
	form.Set("user", userKey)
	form.Set("title", title)
	form.Set("message", message)

	resp, err := http.PostForm("https://api.pushover.net/1/messages.json", form)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("pushover HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

// SendWebhook POSTs a JSON payload to a generic webhook URL.
func SendWebhook(rawURL, kind, title, body string) error {
	payload := map[string]string{
		"kind":  kind,
		"title": title,
		"body":  body,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequest(http.MethodPost, rawURL, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "liquitask-agentd/1.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("webhook HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}
	return nil
}
