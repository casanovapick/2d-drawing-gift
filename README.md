# 🎁 Kawaii Gift Gachapon! — เกมจับฉลากของขวัญ 2D สไตล์ Anime

🌐 **เข้าเล่นออนไลน์ / ติดตั้งลง iOS (PWA):** **https://casanovapick.github.io/2d-drawing-gift/**

เกมหมุนตู้กาชาปองจับฉลากของขวัญ 2D โทน **Kawaii Gift Party** พร้อมฟิสิกส์ลูกแคปซูลในโหลใส พิธีกรสาวน้อยโมเอะชุดนักเรียนญี่ปุ่น (น้องโมจิ) และเสียงพากย์ภาษาไทยแบบ **Offline 100%**

---

## 📱 วิธีนำไปลงเล่นบน iOS (iPhone / iPad) แบบ Offline 100%

เลือกใช้งานได้ 2 วิธีตามความสะดวก (รองรับโหมดเครื่องบินไม่มีเน็ตทั้งคู่):

### วิธีที่ 1: ส่งไฟล์เดียวจบผ่าน AirDrop (เร็วที่สุด ไม่ต้องใช้อินเทอร์เน็ตเลย)
1. ส่งไฟล์ `dist-ios/KawaiiGachapon-iOS-Offline.html` จากเครื่อง Mac เข้า iPhone หรือ iPad ผ่าน **AirDrop** (หรือ LINE / iCloud Drive)
2. เลือก **Save to Files (บันทึกลงแอปไฟล์)**
3. เปิดแอป **Files (ไฟล์)** บน iPhone/iPad แล้วแตะเปิดไฟล์ `KawaiiGachapon-iOS-Offline.html` (หรือกด Share -> เปิดใน Safari) เล่นพร้อมเสียงพากย์ไทยได้ทันทีแม้ปิด Wi-Fi/Cellular!

### วิธีที่ 2: ติดตั้งเป็นไอคอนแอปเต็มจอบนหน้าโฮม (iOS Fullscreen PWA)
1. นำโฟลเดอร์โปรเจกต์ไปอัปโหลดขึ้นเว็บโฮสต์ HTTPS ฟรี (เช่น **GitHub Pages**, **Netlify Drop**, หรือ **Cloudflare Pages**)
2. เปิดลิงก์เว็บด้วยแอป **Safari** บน iPhone/iPad ครั้งแรก 1 ครั้ง (Service Worker `sw.js` จะดาวน์โหลดภาพและไฟล์เสียงไทยทั้งหมดเก็บลงเครื่องอัตโนมัติ)
3. กดปุ่ม **Share (แชร์)** ด้านล่าง Safari -> เลือก **Add to Home Screen (เพิ่มไปยังหน้าจอโฮม)**
4. จะได้ไอคอนแอป **"จับฉลากโมจิ"** รูปน้องโมจิบนหน้าจอโฮม กดเปิดเล่นแบบเต็มจอไร้แถบเบราว์เซอร์ได้ตลอดไปแม้ไม่มีอินเทอร์เน็ต!

---

## 💻 วิธีรันบนเครื่องคอมพิวเตอร์ (macOS)

ดับเบิลคลิกไฟล์ `start-game.command` หรือรันคำสั่ง:

```bash
python3 server.py
```

หากมีการแก้ไขโค้ดและต้องการสร้างไฟล์ `dist-ios/KawaiiGachapon-iOS-Offline.html` ใหม่ รันคำสั่ง:

```bash
python3 scripts/build_ios_offline.py
```
