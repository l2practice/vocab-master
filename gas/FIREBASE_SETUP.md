# VocabMaster — chuyển sang Firebase

Gói miễn phí **Spark** là đủ cho vài trăm SV (xem "Chi phí" cuối trang). Địa chỉ app không đổi: `l2practice.github.io/vocab-master`.

Cho tới khi bật công tắc (bước D), app vẫn chạy bằng Google Sheet như cũ.

## A. Firebase console (console.firebase.google.com)
1. **Add project** (dùng đúng tài khoản Google đang sở hữu Apps Script của VocabMaster), ví dụ tên `vocabmaster-xxxx`. Tắt Google Analytics cũng được.
2. **Authentication ▸ Sign-in method ▸ Email/Password ▸ Enable.**
3. **Authentication ▸ Settings ▸ Authorized domains ▸ Add domain**: `l2practice.github.io`.
4. **Firestore Database ▸ Create database ▸ Production mode**, vùng **asia-southeast1 (Singapore)**.
5. **Firestore ▸ Rules**: dán toàn bộ file `firestore.rules`, rồi bấm **Publish**.
6. **Project settings ▸ General ▸ Your apps ▸ Web (`</>`)**: đăng ký app, copy khối `firebaseConfig`.
7. Dán khối đó vào `vm-common.js` (mục `VM_FIREBASE.config`). **Chưa đổi `enabled`.**

## B. Apps Script (Extensions ▸ Apps Script của sheet VocabMaster)
1. **⚙ Project Settings ▸ tick "Show appsscript.json manifest file in editor"**. Mở `appsscript.json`, dán nội dung `gas/appsscript.json`.
2. **Thêm file mới `FirebaseVM`** và dán `gas/FirebaseVM.gs`. Điền `VMFB.PROJECT_ID` và `VMFB.API_KEY` ở đầu file. Giữ nguyên `Code.gs`.
3. Trong `Code.gs`, hàm `dispatch`, thêm đúng **1 dòng** ngay trước `default:`:
   ```js
   case 'fb.register': case 'fb.registerTeacher': case 'fb.forgotPassword': return fbRoute(action, p);
   ```
4. Chạy **`vmfb_0_TestConnection`** và cấp quyền. Log phải có 4 dòng `OK`.
5. **Deploy ▸ Manage deployments ▸ ✏️ Edit ▸ New version ▸ Deploy.** (cần cho đăng ký và quên mật khẩu trên bản Firebase)

## C. Chuyển dữ liệu (chạy lần lượt; nên làm lúc ít SV đang làm bài)
| Hàm | Việc |
|---|---|
| `vmfb_1_IndexExemptions` | Tắt chỉ mục cho các cột chữ dài. **Đợi 5–10 phút** (Firestore ▸ Indexes ▸ Single field ▸ Exemptions báo xong). |
| `vmfb_2_Teachers` | Tài khoản GV, giữ nguyên email và mật khẩu cũ |
| `vmfb_3_Classes` | Lớp học |
| `vmfb_4_Students` | Tài khoản SV, giữ nguyên Student ID và mật khẩu cũ. Nếu log báo "Tạm dừng…" thì chạy lại. |
| `vmfb_5_Assignments` | Bài tập. Tên được đổi sang `HW_…` / `IC_…`. **Bài bị nhân đôi (một bản có từ, bản kia 0 từ) tự được gộp**, kết quả đã gắn vào bản 0 từ được chuyển sang bản đúng ở bước 6. |
| `vmfb_6_Results` | Kết quả Homework + In-class. Nếu báo "Tạm dừng…" thì chạy lại. |
| `vmfb_7_Rechecks` | Dấu re-check In-class |
| `vmfb_8_Translate` | Bài Luyện Dịch và kết quả |
| `vmfb_9_ReadWise` | Bài đọc tự học của SV |
| `vmfb_91_VocabBank` | Danh sách "Today's word" |

- Chạy lại bước nào cũng an toàn: tài liệu đã có trên Firebase **không bị ghi đè**.
- Google Sheet không bị sửa; nó được giữ làm bản sao lưu.
- Mật khẩu dưới 6 ký tự được tự đệm theo cùng một cách ở cả hai phía, nên SV vẫn gõ mật khẩu cũ như bình thường.

## D. Bật Firebase
Trong `vm-common.js`, đổi `enabled: false` thành `enabled: true` rồi đưa lên GitHub.

Ngay sau đó chạy lại `vmfb_6_Results` để lấy những bài SV làm trong lúc chuyển.
Muốn quay lại bản Sheet: đổi về `enabled: false`.

Sau khi ổn định vài tuần, nên **xoá cột Password trong tab Students/Teachers** của Sheet (mật khẩu ở Firebase đã được mã hoá; trong Sheet vẫn là chữ thường).

## Tính năng mới
- **Không còn bài bị nhân đôi.** Nguyên nhân cũ: lưu bài gửi 2 yêu cầu song song (POST + JSONP) lên Apps Script, cả hai cùng thấy "chưa có bài" nên cùng tạo, bản JSONP không có từ. Giờ mỗi bài chỉ có **một tài liệu**, mã bài tạo sẵn ở trình duyệt, ghi đúng một lần.
- **Tên bài tự có tiền tố**: Homework → `HW_`, In-class → `IC_`. Gõ `HW_Unit 5`, `hw unit 5` hay `Unit 5` đều ra `HW_Unit 5`; đổi mode thì tiền tố đổi theo. Form hiển thị trước tên sẽ lưu.
- **Gia hạn (⏱ Extend)** ở danh sách bài (cả Homework và In-class):
  - *Cả lớp* hoặc *một số SV* (chọn từ danh sách lớp).
  - Nút nhanh +15 phút / +30 phút / +1 giờ (In-class) hoặc +1 / +3 / +7 ngày (Homework), hoặc chọn giờ bất kỳ.
  - In-class: SV được gia hạn thấy phiên còn mở và đồng hồ đếm ngược chạy đến giờ mới; SV đã bị tự nộp vì hết giờ được làm lại.
  - Homework: bài quá hạn vẫn hiện cho SV được gia hạn. Hạn nộp dạng ngày (`2026-10-05`) nay tính đến **hết ngày đó** (trước đây hết hạn lúc 7h sáng).
  - Mục "Gia hạn đang áp dụng" trong hộp thoại có nút **Gỡ**.

## Dữ liệu trên Firestore
| Collection | Nội dung |
|---|---|
| `users/{uid}` | Hồ sơ SV và GV (role, studentId, fullName, classId, teacherUid, email, archived) |
| `loginIndex/{sha256(email)}` | Email → Student ID, dùng khi SV đăng nhập bằng email |
| `classes/{classId}` | Lớp |
| `assignments/{id}` | **1 tài liệu / bài**: từ vựng, hạn, giờ phiên, `extAll` + `ext{studentId}` (gia hạn) |
| `results/{bài}_{uid}` | **1 tài liệu / (SV × bài)**: toàn bộ lần làm (`runs`). Bảng kết quả của GV đọc thẳng, không cần cộng dồn |
| `rechecks/{bài}_{uid}` | Dấu re-check của GV |
| `trSets`, `trProgress` | Bài Luyện Dịch và tiến độ |
| `readwise/{id}` | Bài đọc tự học |
| `vocabBank/{meta,c0…}` | "Today's word", 100 từ / tài liệu (1–2 lượt đọc mỗi ngày) |

## Chi phí (Spark, miễn phí)
Giới hạn mỗi ngày: 50.000 lượt đọc, 20.000 lượt ghi, 20.000 lượt xoá. Ước tính cho lớp 40 SV:
- SV mở app: ~1 lượt đọc hồ sơ + số bài của lớp + số bài đã làm ≈ 20–40 lượt. Mỗi lần nộp bài = 1 lượt ghi (không cần đọc trước).
- GV xem Results của 1 lớp: 1 lượt đọc / (SV × bài) trong lớp (≈ vài trăm lần xem mỗi học kỳ; kết quả được giữ 30 giây khi lật trang). Chọn một bài cụ thể trong bộ lọc sẽ chỉ đọc ~40 lượt.
- 1.000 SV dùng đều mỗi ngày vẫn nằm trong gói miễn phí; nếu vượt, gói Blaze tính khoảng 0,06 USD cho mỗi 100.000 lượt đọc.

## Giới hạn đã biết
- Đổi **email** của SV trong Roster chỉ cập nhật hồ sơ; đăng nhập bằng email vẫn theo email lúc đăng ký (đăng nhập bằng Student ID luôn đúng).
- Thời gian In-class do trình duyệt SV kiểm tra (như bản cũ); chưa chặn nộp muộn ở phía máy chủ.
