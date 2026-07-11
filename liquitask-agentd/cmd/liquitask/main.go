// liquitask — companion CLI for the liquitask-agentd supervisor daemon.
//
// Talks to the Phase 1 authenticated socket at ~/.liquitask/agentd/agentd.sock.
package main

import (
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/liquitask/liquitask-agentd/internal/cli"
)

func main() {
	dataDir := flag.String("data-dir", cli.DefaultDataDir(), "agentd data directory")
	asJSON := flag.Bool("json", false, "emit machine-readable JSON")
	tail := flag.Int("tail", 0, "limit transcript/logs to last N lines")
	flag.Parse()

	cfg := cli.Config{DataDir: *dataDir, JSON: *asJSON}
	args := flag.Args()
	if len(args) == 0 {
		printUsage(os.Stderr)
		os.Exit(2)
	}

	var err error
	switch args[0] {
	case "list":
		err = cli.List(cfg)
	case "status":
		err = cli.Status(cfg)
	case "show":
		err = needArgs(args, 2, "show <run>")
		if err == nil {
			err = cli.Show(cfg, args[1])
		}
	case "transcript":
		err = needArgs(args, 2, "transcript <run>")
		if err == nil {
			err = cli.Transcript(cfg, args[1], *tail)
		}
	case "logs":
		err = needArgs(args, 2, "logs <run>")
		if err == nil {
			err = cli.Logs(cfg, args[1], *tail)
		}
	case "send":
		err = needArgs(args, 3, "send <run> <message>")
		if err == nil {
			err = cli.Send(cfg, args[1], strings.Join(args[2:], " "))
		}
	case "interrupt":
		err = needArgs(args, 2, "interrupt <run>")
		if err == nil {
			err = cli.Interrupt(cfg, args[1])
		}
	case "approve":
		runID, requestID, parseErr := parsePermissionArgs(args[1:])
		if parseErr != nil {
			err = parseErr
		} else {
			err = cli.PermissionRespond(cfg, runID, requestID, "approve")
		}
	case "deny":
		runID, requestID, parseErr := parsePermissionArgs(args[1:])
		if parseErr != nil {
			err = parseErr
		} else {
			err = cli.PermissionRespond(cfg, runID, requestID, "deny")
		}
	case "board":
		err = cli.RunBoardCommand(cfg, args[1:])
	case "trace":
		err = needArgs(args, 3, "trace list <run>")
		if err == nil && args[1] == "list" {
			err = cli.TraceList(cfg, args[2])
		} else if err == nil {
			err = fmt.Errorf("usage: liquitask trace list <run>")
		}
	case "help", "-h", "--help":
		printUsage(os.Stdout)
		return
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n", args[0])
		printUsage(os.Stderr)
		os.Exit(2)
	}

	if err != nil {
		if *asJSON {
			_ = cli.EmitError(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func needArgs(args []string, n int, usage string) error {
	if len(args) < n {
		return fmt.Errorf("usage: liquitask %s", usage)
	}
	return nil
}

func parsePermissionArgs(args []string) (runID, requestID string, err error) {
	if len(args) == 2 {
		return args[0], args[1], nil
	}
	if len(args) == 1 {
		parts := strings.SplitN(args[0], ":", 2)
		if len(parts) == 2 && parts[0] != "" && parts[1] != "" {
			return parts[0], parts[1], nil
		}
	}
	return "", "", fmt.Errorf("usage: liquitask approve|deny <run> <request> (or <run>:<request>)")
}

func printUsage(w *os.File) {
	fmt.Fprintln(w, `liquitask — LiquiTask agent supervisor CLI

Usage:
  liquitask [flags] <command> [args]

Commands:
  list                         List runs grouped by status (includes queue)
  status                       Summary counts and token usage
  show <run>                   Show run metadata
  transcript <run>             Print stdout.ndjson transcript
  logs <run>                   Print log-level events from stdout.ndjson
  send <run> <message>         Inject guidance into a live run
  interrupt <run>              Cancel a live run
  approve <run> <request>      Approve a pending permission request
  deny <run> <request>         Deny a pending permission request
  board list [--column]        List board tasks (reads board-snapshot.json)
  board show <task>            Show one task card
  board create <title> [...]   Create a task in the snapshot
  board assign <task> <agent>  Assign a task to an agent
  board dispatch <task>        Start an agent run for a task
  trace list <run>             List reversible trace steps for a run

Flags:
  --json                       Emit JSON (all commands)
  --data-dir <path>            Agentd data dir (default ~/.liquitask/agentd)
  --tail <n>                   Limit transcript/logs output to last N lines`)
}
