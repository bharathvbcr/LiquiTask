package workspaceauth

import "testing"

func TestIsPathAuthorized_blocks_outside_paths(t *testing.T) {
	t.Parallel()
	authorized := []string{"/home/user/notes"}
	if IsPathAuthorized("/home/user/private/secret.md", authorized) {
		t.Fatal("expected path outside authorized roots to be denied")
	}
}

func TestIsPathAuthorized_allows_nested_files(t *testing.T) {
	t.Parallel()
	authorized := []string{"/home/user/notes"}
	if !IsPathAuthorized("/home/user/notes/daily.md", authorized) {
		t.Fatal("expected nested file inside authorized root")
	}
}

func TestIsPathAuthorized_blocks_prefix_trick(t *testing.T) {
	t.Parallel()
	authorized := []string{"/home/user/notes"}
	if IsPathAuthorized("/home/user/notes-evil/file.md", authorized) {
		t.Fatal("expected notes-evil prefix trick to be denied")
	}
}

func TestAuthorizeDir_rejects_empty_allowlist(t *testing.T) {
	t.Parallel()
	if _, err := AuthorizeDir("/tmp/project", nil); err == nil {
		t.Fatal("expected error when allowlist is empty")
	}
}
