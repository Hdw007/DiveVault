package store

import (
	"testing"
)

func TestReplaceTokenInList(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		oldName     string
		newName     string
		wantStr     string
		wantChanged bool
	}{
		{
			name:        "exact single token",
			input:       "Alice",
			oldName:     "Alice",
			newName:     "Bob",
			wantStr:     "Bob",
			wantChanged: true,
		},
		{
			name:        "multiple tokens at start",
			input:       "Alice, Charlie",
			oldName:     "Alice",
			newName:     "Bob",
			wantStr:     "Bob, Charlie",
			wantChanged: true,
		},
		{
			name:        "multiple tokens in middle",
			input:       "Charlie, Alice, Dave",
			oldName:     "Alice",
			newName:     "Bob",
			wantStr:     "Charlie, Bob, Dave",
			wantChanged: true,
		},
		{
			name:        "multiple tokens at end",
			input:       "Charlie, Alice",
			oldName:     "Alice",
			newName:     "Bob",
			wantStr:     "Charlie, Bob",
			wantChanged: true,
		},
		{
			name:        "no match",
			input:       "Charlie, Dave",
			oldName:     "Alice",
			newName:     "Bob",
			wantStr:     "Charlie, Dave",
			wantChanged: false,
		},
		{
			name:        "substring is not replaced",
			input:       "Aliceson, Charlie",
			oldName:     "Alice",
			newName:     "Bob",
			wantStr:     "Aliceson, Charlie",
			wantChanged: false,
		},
		{
			name:        "empty inputs",
			input:       "",
			oldName:     "Alice",
			newName:     "Bob",
			wantStr:     "",
			wantChanged: false,
		},
		{
			name:        "whitespace trimmed match",
			input:       "  Alice  , Charlie",
			oldName:     "Alice",
			newName:     "Bob",
			wantStr:     "  Bob  , Charlie",
			wantChanged: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotStr, gotChanged := replaceTokenInList(tt.input, tt.oldName, tt.newName)
			if gotChanged != tt.wantChanged {
				t.Errorf("replaceTokenInList() changed = %v, want %v", gotChanged, tt.wantChanged)
			}
			if gotStr != tt.wantStr {
				t.Errorf("replaceTokenInList() = %q, want %q", gotStr, tt.wantStr)
			}
		})
	}
}

