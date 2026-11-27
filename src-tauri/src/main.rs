// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // แอปที่ติดตั้งแล้วเริ่มเป็น supervisor ของตัวเองก่อน ซึ่งเปิดแอปใหม่ให้ถ้าแอปปิดไป
    bonio_booth_lib::supervisor::run_or_supervise();
    bonio_booth_lib::run()
}
