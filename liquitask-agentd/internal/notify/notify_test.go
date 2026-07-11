package notify

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestDispatcherSuppressionWindow(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	d := NewDispatcher()
	d.SetConfig(Config{
		Enabled:    true,
		Provider:   "webhook",
		WebhookURL: srv.URL,
	})

	d.MaybeSend("permission_request", "Title", "Body", "perm:run-1")
	d.MaybeSend("permission_request", "Title", "Body", "perm:run-1")

	if got := hits.Load(); got != 1 {
		t.Fatalf("expected 1 webhook call within suppression window, got %d", got)
	}

	time.Sleep(SuppressionWindow + 50*time.Millisecond)
	d.MaybeSend("permission_request", "Title", "Body", "perm:run-1")
	if got := hits.Load(); got != 2 {
		t.Fatalf("expected second webhook after suppression window, got %d", got)
	}
}

func TestSendPushoverRequiresNetwork(t *testing.T) {
	// Smoke: invalid credentials should not panic.
	if err := SendPushover("", "", "title", "body"); err == nil {
		t.Skip("pushover accepted empty credentials in this environment")
	}
}

func TestSendWebhookPayload(t *testing.T) {
	var got map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		raw, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(raw, &got); err != nil {
			t.Fatalf("invalid json: %v", err)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	if err := SendWebhook(srv.URL, "run_failed", "Run failed", "Agent error"); err != nil {
		t.Fatalf("SendWebhook: %v", err)
	}
	if got["kind"] != "run_failed" || got["title"] != "Run failed" || got["body"] != "Agent error" {
		t.Fatalf("unexpected payload: %#v", got)
	}
}
