use tauri_plugin_dialog::DialogExt;

#[tauri::command]
async fn save_book_json(app: tauri::AppHandle, file_name: String, content: String) -> Result<bool, String> {
    let selected = app
        .dialog()
        .file()
        .set_file_name(file_name)
        .add_filter("JSON", &["json"])
        .blocking_save_file();
    let Some(selected) = selected else {
        return Ok(false);
    };
    let path = selected.into_path().map_err(|error| error.to_string())?;
    std::fs::write(path, content).map_err(|error| error.to_string())?;
    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_book_json])
        .run(tauri::generate_context!())
        .expect("Koin failed to start");
}
