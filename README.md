# BR Smart Timetable · โรงเรียนบ้านไร่
ระบบจัดตารางสอนออนไลน์ (Cloudflare Pages + Functions + D1) · พัฒนาโดย ครูเฉลิมพล จันทร์แดง

## ติดตั้ง
1. `npm i -g wrangler && wrangler login`
2. `wrangler d1 create br-timetable` → ใส่ `database_id` ใน `wrangler.toml`
3. `wrangler d1 execute br-timetable --remote --file=db/schema.sql` (รันซ้ำได้ปลอดภัย)
4. push ขึ้น GitHub → Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git (Build command ว่าง, Output `public`)
5. Settings → Bindings → D1 database ชื่อ `DB` เลือก `br-timetable` แล้ว Deploy ใหม่

ทดสอบในเครื่อง: `wrangler d1 execute br-timetable --local --file=db/schema.sql && wrangler pages dev public`

## ความปลอดภัย (ไม่มีล็อกอิน)
ใครมีลิงก์ก็แก้ข้อมูลได้ แนะนำเปิด **Cloudflare Access** (Zero Trust, ฟรีไม่เกิน 50 ผู้ใช้) ครอบโดเมนของระบบ
และดาวน์โหลดไฟล์สำรองจากเมนู "ฉบับตาราง/สำรอง" เป็นประจำ

## เกณฑ์ตรวจรับ (ทดสอบก่อนเปิดใช้จริง)
- [ ] เพิ่มครู วิชา ชั้น ห้อง เวลาเรียน แล้วจัดตารางได้ทั้งคอมและมือถือ
- [ ] ลากวาง/ย้ายคาบ ระบบไม่ยอมให้ครู ห้อง ชั้นชนคาบ และไม่ให้วางช่วงพัก
- [ ] สอนแทนแล้วตารางประจำไม่เปลี่ยน ครูแทนที่ติดคาบเลือกไม่ได้
- [ ] พิมพ์รายครู/รายชั้น/รายห้อง/ทุกคน/รายงาน ด้วย Chrome หรือ Edge และเครื่องพิมพ์จริง
- [ ] เปิดจากอีกเครื่องแล้วเห็นข้อมูลเดียวกัน
- [ ] ดาวน์โหลดไฟล์สำรองและทดลองกู้คืนบนข้อมูลสำเนา

## ข้อมูลตัวอย่าง
รัน `db/sample-1-master.sql` แล้วตามด้วย `db/sample-2-timetable.sql` (หรือไฟล์เดียว `db/sample-data.sql`) ใน D1 Console (หลัง `schema.sql`) เพื่อใส่ครู 8 ท่าน ชั้นอนุบาล 2–ป.6 วิชา ห้อง และตารางสอนตัวอย่าง **คำเตือน: ไฟล์นี้ลบข้อมูลเดิมแล้วแทนที่ทั้งหมด**
