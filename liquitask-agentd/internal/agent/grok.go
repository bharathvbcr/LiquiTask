package agent

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/liquitask/liquitask-agentd/internal/execenv"
)

// grokBackend implements Backend by spawning the xAI Grok Build CLI with
// --output-format streaming-json and parsing the NDJSON event stream. The
// protocol mirrors Cursor's stream-json shape; the parser is tolerant of
// unknown event types.
type grokBackend struct {
	cfg Config
}

func (b *grokBackend) Execute(ctx context.Context, prompt string, opts ExecOptions) (*Session, error) {
	execName := b.cfg.ExecutablePath
	if execName == "" {
		execName = "grok"
	}
	lookedUp, err := exec.LookPath(execName)
	if err != nil {
		return nil, fmt.Errorf("grok executable not found at %q: %w", execName, err)
	}

	if err := prepareGrokRunMcp(opts.Cwd, opts.McpConfig); err != nil {
		return nil, err
	}

	timeout := opts.Timeout
	runCtx, cancel := runContext(ctx, timeout)

	args := buildGrokArgs(prompt, opts, b.cfg.Logger)
	cmd := exec.CommandContext(runCtx, execName, args...)
	hideAgentWindow(cmd)
	if err := PrepareManagedCommand(cmd, opts, 500*time.Millisecond); err != nil {
		cancel()
		return nil, err
	}
	b.cfg.Logger.Info("agent command", "exec", execName, "args", args)
	if opts.Cwd != "" {
		cmd.Dir = opts.Cwd
	}
	cmd.Env = buildEnv(b.cfg.Env)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return nil, fmt.Errorf("grok stdout pipe: %w", err)
	}
	cmd.Stderr = newLogWriter(b.cfg.Logger, "[grok:stderr] ")

	if err := cmd.Start(); err != nil {
		cancel()
		return nil, fmt.Errorf("start grok: %w", err)
	}

	b.cfg.Logger.Info("grok started", "pid", cmd.Process.Pid, "cwd", opts.Cwd, "model", opts.Model, "resolved", lookedUp)

	msgCh := make(chan Message, 256)
	resCh := make(chan Result, 1)

	go func() {
		defer cancel()
		defer close(msgCh)
		defer close(resCh)

		go func() {
			<-runCtx.Done()
			_ = stdout.Close()
		}()

		startTime := time.Now()
		configuredModel := strings.TrimSpace(opts.Model)
		var output strings.Builder
		var sessionID string
		finalStatus := "completed"
		var finalError string
		resultSeen := false
		stepUsage := make(map[string]TokenUsage)
		resultUsage := make(map[string]TokenUsage)
		hasResultUsage := false

		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 0, 1024*1024), 10*1024*1024)

		for scanner.Scan() {
			line := normalizeCursorStreamLine(scanner.Text())
			if line == "" {
				continue
			}

			var evt cursorStreamEvent
			if err := json.Unmarshal([]byte(line), &evt); err != nil {
				continue
			}

			if sid := evt.readSessionID(); sid != "" {
				sessionID = sid
			}

			switch evt.Type {
			case "system":
				if evt.Subtype == "init" {
					trySend(msgCh, Message{Type: MessageStatus, Status: "running"})
				}
				if evt.Subtype == "error" {
					errMsg := cursorErrorText(&evt)
					if errMsg != "" {
						trySend(msgCh, Message{Type: MessageError, Content: errMsg})
					}
				}
			case "assistant":
				b.handleGrokAssistant(&evt, msgCh, &output)
			case "tool_use":
				var params map[string]any
				if evt.Parameters != nil {
					_ = json.Unmarshal(evt.Parameters, &params)
				}
				trySend(msgCh, Message{
					Type:   MessageToolUse,
					Tool:   evt.ToolName,
					CallID: evt.ToolID,
					Input:  params,
				})
			case "tool_result":
				trySend(msgCh, Message{
					Type:   MessageToolResult,
					CallID: evt.ToolID,
					Output: evt.Output,
				})
			case "result":
				resultSeen = true
				if evt.IsError || evt.Subtype == "error" {
					finalStatus = "failed"
					finalError = cursorErrorText(&evt)
				}
				if evt.ResultText != "" && output.Len() == 0 {
					output.WriteString(evt.ResultText)
					trySend(msgCh, Message{Type: MessageText, Content: evt.ResultText})
				}
				b.accumulateGrokResultUsage(resultUsage, &evt, configuredModel)
				if evt.hasResultUsage() {
					hasResultUsage = true
				}
				cancel()
			case "error":
				errMsg := cursorErrorText(&evt)
				if errMsg != "" {
					finalError = errMsg
				}
				trySend(msgCh, Message{Type: MessageError, Content: errMsg})
			case "text":
				if evt.Part != nil {
					var part cursorTextPart
					_ = json.Unmarshal(evt.Part, &part)
					if part.Text != "" {
						output.WriteString(part.Text)
						trySend(msgCh, Message{Type: MessageText, Content: part.Text})
					}
				}
			case "step_finish":
				if evt.Part != nil {
					var part cursorStepFinishPart
					_ = json.Unmarshal(evt.Part, &part)
					model := cursorUsageModel(evt.Model, configuredModel)
					u := stepUsage[model]
					u.InputTokens += int64(part.Tokens.Input)
					u.OutputTokens += int64(part.Tokens.Output)
					u.CacheReadTokens += int64(part.Tokens.Cache.Read)
					stepUsage[model] = u
				}
			}
		}

		if !hasResultUsage {
			resultUsage = stepUsage
		}

		exitErr := cmd.Wait()
		duration := time.Since(startTime)

		if runCtx.Err() == context.DeadlineExceeded {
			finalStatus = "timeout"
			finalError = fmt.Sprintf("grok timed out after %s", timeout)
		} else if runCtx.Err() == context.Canceled && !resultSeen {
			finalStatus = "aborted"
			finalError = "execution cancelled"
		} else if exitErr != nil && finalStatus == "completed" && !resultSeen {
			finalStatus = "failed"
			finalError = fmt.Sprintf("grok exited with error: %v", exitErr)
		}

		b.cfg.Logger.Info("grok finished", "pid", cmd.Process.Pid, "status", finalStatus, "duration", duration.Round(time.Millisecond).String())

		resCh <- Result{
			Status:     finalStatus,
			Output:     output.String(),
			Error:      finalError,
			DurationMs: duration.Milliseconds(),
			SessionID:  sessionID,
			Usage:      resultUsage,
		}
	}()

	sess := &Session{Messages: msgCh, Result: resCh}
	sess.pid.Store(int32(cmd.Process.Pid))
	return sess, nil
}

func (b *grokBackend) handleGrokAssistant(evt *cursorStreamEvent, ch chan<- Message, output *strings.Builder) {
	(&cursorBackend{cfg: b.cfg}).handleCursorAssistant(evt, ch, output)
}

func (b *grokBackend) accumulateGrokResultUsage(usage map[string]TokenUsage, evt *cursorStreamEvent, configuredModel string) {
	(&cursorBackend{cfg: b.cfg}).accumulateResultUsage(usage, evt, configuredModel)
}

func prepareGrokRunMcp(workDir string, mcpConfig json.RawMessage) error {
	if !hasManagedMcpConfig(mcpConfig) || workDir == "" {
		return nil
	}
	return execenv.PrepareGrokMcpConfig(workDir, mcpConfig)
}

var grokBlockedArgs = map[string]blockedArgMode{
	"-p":               blockedStandalone,
	"--output-format":  blockedWithValue,
	"--always-approve": blockedStandalone,
	"--no-auto-update": blockedStandalone,
	"--cwd":            blockedWithValue,
}

// buildGrokArgs assembles argv for a headless grok invocation:
//
//	grok --no-auto-update -p <prompt> --output-format streaming-json
//	     [--always-approve] --cwd <cwd> [-m <model>] [-r <sessionId>]
func buildGrokArgs(prompt string, opts ExecOptions, logger *slog.Logger) []string {
	args := []string{
		"--no-auto-update",
		"-p", prompt,
		"--output-format", "streaming-json",
	}
	if ShouldBypassPermissions(opts) {
		args = append(args, "--always-approve")
	}
	if opts.Cwd != "" {
		args = append(args, "--cwd", opts.Cwd)
	}
	if opts.Model != "" {
		args = append(args, "-m", opts.Model)
	}
	if opts.ResumeSessionID != "" {
		args = append(args, "-r", opts.ResumeSessionID)
	}
	args = append(args, filterCustomArgs(opts.CustomArgs, grokBlockedArgs, logger)...)
	return args
}

func agentdDataRoot() string {
	if root := strings.TrimSpace(os.Getenv("LIQUITASK_AGENTD_DATA")); root != "" {
		return root
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(os.TempDir(), "liquitask-agentd")
	}
	return filepath.Join(home, ".liquitask", "agentd")
}

func hasManagedMcpConfig(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}
	trimmed := strings.TrimSpace(string(raw))
	return trimmed != "" && trimmed != "null"
}
