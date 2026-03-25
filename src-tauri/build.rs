fn main() {
    let mcp_cap_path = std::path::Path::new("capabilities/mcp-bridge.json");

    #[cfg(all(feature = "mcp-bridge", debug_assertions))]
    {
        let cap = r#"{
  "identifier": "mcp-bridge",
  "description": "Enables MCP bridge for development",
  "windows": [
    "main"
  ],
  "permissions": [
    "mcp-bridge:default"
  ]
}"#;

        let should_write = match std::fs::read_to_string(mcp_cap_path) {
            Ok(existing) => existing != cap,
            Err(_) => true,
        };

        if should_write {
            std::fs::write(mcp_cap_path, cap).expect("failed to write mcp-bridge capability");
        }
    }

    #[cfg(not(all(feature = "mcp-bridge", debug_assertions)))]
    {
        let _ = std::fs::remove_file(mcp_cap_path);
    }

    tauri_build::build()
}
