package daemon

// PORT STUB — not ported as-is.
//
// Upstream server/internal/daemon/local_skill_report_test.go exercises
// Daemon.reportLocalSkillListResult / reportLocalSkillImportResult: retry/backoff
// logic around POSTing local-skill list/import results back to the Multica
// cloud server at /api/daemon/runtimes/{id}/local-skills/{result-kind}/{requestID}/result,
// via an httptest.Server standing in for that remote API and a *daemon.Client
// HTTP client (see daemon.go's Daemon struct, client.go's Client/NewClient, and
// the package-level runtimeReportBackoffs retry schedule).
//
// liquitask-agentd is a local single-user sidecar with no server uplink: there is
// no remote Multica control plane to report local-skill-list/import results to,
// so reportLocalSkillListResult/reportLocalSkillImportResult and the Daemon/Client
// types that host them have no local equivalent in this pass. The actual
// filesystem skill-discovery logic those handlers wrap — listRuntimeLocalSkills
// and loadRuntimeLocalSkillBundle — has no server coupling and was ported as-is
// into local_skills.go / local_skills_test.go in this same change.
//
// If liquitask-agentd later grows a result-reporting surface (e.g. reporting
// local-skill list/import completion to the Tauri frontend over the local RPC
// channel instead of a cloud API), re-introduce an equivalent test here against
// that local channel rather than reviving the HTTP retry-to-cloud-server test as
// written.
