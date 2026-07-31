export interface SlashCommand {
  name: string; // e.g. "/help"
  description: string;
}

export const COMMANDS: SlashCommand[] = [
  { name: "/help", description: "Show all available commands" },
  { name: "/init", description: "Initialize the current project" },
  { name: "/new", description: "Start a new conversation" },
  { name: "/clear", description: "Clear the current chat" },
  { name: "/history", description: "View conversation history" },
  { name: "/resume", description: "Resume the last conversation" },
  { name: "/save", description: "Save the current conversation" },
  { name: "/load", description: "Load a saved conversation" },
  { name: "/search", description: "Search previous conversations" },
  { name: "/cd", description: "Change the working/project directory" },
  { name: "/model", description: "Switch AI model" },
  { name: "/skills", description: "View installed skills" },
  { name: "/install", description: "Install a skill from a link" },
  { name: "/provider", description: "Change AI provider" },
  { name: "/context", description: "View current context" },
  { name: "/memory", description: "Manage AI memory" },
  { name: "/config", description: "Edit CLI configuration" },
  { name: "/settings", description: "Open settings" },
  { name: "/theme", description: "Change the interface theme" },
  { name: "/tools", description: "List available tools" },
  { name: "/status", description: "Show session status" },
  { name: "/tokens", description: "Display token usage" },
  { name: "/stats", description: "Show usage statistics" },
  { name: "/version", description: "Display CLI version" },
  { name: "/update", description: "Check for updates" },
  { name: "/feedback", description: "Send feedback" },
  { name: "/bug", description: "Report a bug" },
  { name: "/doctor", description: "Run diagnostics" },
  { name: "/reset", description: "Reset all settings" },
  { name: "/restart", description: "Restart the CLI" },
  { name: "/exit", description: "Exit the application" },
];
