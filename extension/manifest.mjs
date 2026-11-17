export const targets = ['chrome', 'firefox'];
export const version = '0.1.0';

const manifests = {
  "chrome": {
    "manifest_version": 3,
    "name": "tokei / wasm",
    "version": "0.1.0",
    "description": "Count code, comments and blank lines in public GitHub repositories or local files using Rust tokei and WebAssembly.",
    "icons": {
      "16": "favicon-16x16.png",
      "32": "favicon-32x32.png"
    },
    "action": {
      "default_title": "Analyze with tokei",
      "default_icon": {
        "16": "favicon-16x16.png",
        "32": "favicon-32x32.png"
      }
    },
    "permissions": [
      "activeTab"
    ],
    "host_permissions": [
      "https://api.github.com/*",
      "https://raw.githubusercontent.com/*"
    ],
    "background": {
      "service_worker": "background.js",
      "type": "module"
    },
    "content_security_policy": {
      "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; worker-src 'self'; connect-src 'self' https://api.github.com https://raw.githubusercontent.com"
    }
  },
  "firefox": {
    "manifest_version": 3,
    "name": "tokei / wasm",
    "version": "0.1.0",
    "description": "Count code, comments and blank lines in public GitHub repositories or local files using Rust tokei and WebAssembly.",
    "icons": {
      "16": "favicon-16x16.png",
      "32": "favicon-32x32.png"
    },
    "action": {
      "default_title": "Analyze with tokei",
      "default_icon": {
        "16": "favicon-16x16.png",
        "32": "favicon-32x32.png"
      }
    },
    "permissions": [
      "activeTab"
    ],
    "host_permissions": [
      "https://api.github.com/*",
      "https://raw.githubusercontent.com/*"
    ],
    "background": {
      "scripts": [
        "background.js"
      ],
      "type": "module"
    },
    "content_security_policy": {
      "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; worker-src 'self'; connect-src 'self' https://api.github.com https://raw.githubusercontent.com"
    },
    "browser_specific_settings": {
      "gecko": {
        "id": "tokei-wasm@kojix2.github.io",
        "strict_min_version": "140.0",
        "data_collection_permissions": {
          "required": [
            "none"
          ]
        }
      }
    }
  }
};

export function createManifest(target) {
  if (!targets.includes(target)) throw Error(`Unknown extension target: ${target}`);
  return structuredClone(manifests[target]);
}
