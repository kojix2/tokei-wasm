//! Browser adapter for the upstream `tokei` crate.
//!
//! All code/comment/blank classification is performed by upstream
//! `LanguageType::parse_from_slice`, NOT by an independently-written lexer.
//! Paths are used only for language selection (there is no filesystem in browser Wasm).
use serde::Serialize;
use tokei::{CodeStats, Config, LanguageType};
use wasm_bindgen::prelude::*;

/// Unlike LanguageType::from_path(), this function never accesses a filesystem.
fn language_from_virtual_path(path: &str) -> Option<LanguageType> {
    let name = path.rsplit(['/', '\\']).next()?.to_ascii_lowercase();
    match name.as_str() {
        "dockerfile" => return Some(LanguageType::Dockerfile),
        "makefile" | "gnumakefile" => return Some(LanguageType::Makefile),
        "gemfile" | "rakefile" | "guardfile" | "podfile" => return Some(LanguageType::Ruby),
        "cmakelists.txt" => return Some(LanguageType::CMake),
        "justfile" => return Some(LanguageType::Just),
        "cargo.lock" | "pipfile" => return Some(LanguageType::Toml),
        ".editorconfig" => return Some(LanguageType::Ini),
        _ => {}
    }
    if name.starts_with("dockerfile.") {
        return Some(LanguageType::Dockerfile);
    }
    let extension = name.rsplit_once('.')?.1;
    if extension.is_empty() {
        return None;
    }
    LanguageType::from_file_extension(extension)
}

#[wasm_bindgen]
pub fn detect_language(path: &str) -> Option<String> {
    language_from_virtual_path(path).map(|l| l.name().to_owned())
}

#[derive(Serialize)]
struct Counts {
    code: usize,
    comments: usize,
    blanks: usize,
}
impl From<&CodeStats> for Counts {
    fn from(v: &CodeStats) -> Self {
        Self {
            code: v.code,
            comments: v.comments,
            blanks: v.blanks,
        }
    }
}

#[derive(Serialize)]
struct Embedded {
    language: String,
    stats: Counts,
}

#[derive(Serialize)]
struct CountedFile {
    language: String,
    stats: Counts,
    /// Embedded language counts from tokei (e.g. code fences in Markdown).
    embedded: Vec<Embedded>,
}

/// Parse file contents using unmodified upstream `tokei` parsing logic.
/// Return `null` for an unrecognized filename, without guessing a language.
#[wasm_bindgen]
pub fn count_file(path: &str, bytes: &[u8]) -> Result<JsValue, JsValue> {
    let Some(language) = language_from_virtual_path(path) else {
        return Ok(JsValue::NULL);
    };
    let parsed = language.parse_from_slice(bytes, &Config::default());
    let embedded: Vec<_> = parsed
        .blobs
        .iter()
        .map(|(lang, stats)| Embedded {
            language: lang.name().to_owned(),
            stats: Counts::from(&stats.summarise()),
        })
        .collect();
    // tokei merges the per-file child blobs when presenting summarized statistics.
    let summarized = parsed.summarise();
    let result = CountedFile {
        language: language.name().to_owned(),
        stats: Counts::from(&summarized),
        embedded,
    };
    serde_wasm_bindgen::to_value(&result).map_err(|err| JsValue::from_str(&err.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_resolution_never_uses_disk() {
        assert_eq!(
            language_from_virtual_path("x/src/lib.rs"),
            Some(LanguageType::Rust)
        );
        assert_eq!(
            language_from_virtual_path("src/main.cr"),
            Some(LanguageType::Crystal)
        );
        assert_eq!(
            language_from_virtual_path("src/Dockerfile"),
            Some(LanguageType::Dockerfile)
        );
        assert_eq!(
            language_from_virtual_path("Rakefile"),
            Some(LanguageType::Ruby)
        );
        assert_eq!(
            language_from_virtual_path("src/main.RS"),
            Some(LanguageType::Rust)
        );
        assert_eq!(
            language_from_virtual_path("a/file.unknown-special-extension"),
            None
        );
    }

    #[test]
    fn upstream_parser_counts_comments() {
        let stats =
            LanguageType::Rust.parse_from_slice(b"let x = 1;\n// hi\n\n", &Config::default());
        assert_eq!((stats.code, stats.comments, stats.blanks), (1, 1, 1));
    }

    #[test]
    fn upstream_parser_handles_nested_comments() {
        let stats = LanguageType::Rust.parse_from_slice(
            b"/* outer /* inner */ outer */\nfn main() {}\n",
            &Config::default(),
        );
        assert_eq!(stats.code, 1);
        assert_eq!(stats.comments, 1);
    }
}
