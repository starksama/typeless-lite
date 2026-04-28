fn main() {
    #[cfg(target_os = "macos")]
    {
        cc::Build::new()
            .file("src/macos_permissions.m")
            .flag("-fobjc-arc")
            .compile("macos_permissions");
        println!("cargo:rustc-link-lib=framework=AVFoundation");
        println!("cargo:rustc-link-lib=framework=Foundation");
    }

    tauri_build::build();
}
