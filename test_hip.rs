fn main() {
    let ALLOWED_HIP3: [&str; 1] = ["xyz"];
    let dex_name = String::from("XYZ");
    let name = dex_name.to_lowercase();
    let name_str = name.as_str();
    println!("{}", ALLOWED_HIP3.contains(&name_str));
}
