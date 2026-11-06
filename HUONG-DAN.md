# Quét giấy tờ – hướng dẫn cài đặt

App chạy trên trình duyệt của điện thoại (iPhone và Android), cài ra màn hình chính như app thường. Giơ máy lên, app tự tìm mép giấy, giữ yên chừng 1 giây là tự chụp, nắn thẳng, làm trắng nền, lưu thành PDF rồi đẩy lên Google Drive của bạn.

Làm 3 việc, mỗi việc một lần duy nhất:

---

## Bước 1. Tạo "cầu nối" lên Google Drive (khoảng 5 phút)

1. Trên máy tính, vào **https://script.google.com**, đăng nhập đúng tài khoản Google muốn lưu file.
2. Bấm **Dự án mới**. Xóa hết đoạn code có sẵn, dán toàn bộ nội dung file `google-apps-script/Code.gs` vào.
3. Sửa dòng `const MA_BI_MAT = '...'` thành một chuỗi riêng, ví dụ `'hungphuoc-2026-xyz'`. Ghi lại chuỗi này.
4. Bấm biểu tượng 💾 để lưu. Đặt tên dự án tùy ý, ví dụ "Quét giấy tờ".
5. Ở ô chọn hàm phía trên, chọn **capQuyen**, bấm **Chạy**.
   Google sẽ hỏi cấp quyền: chọn tài khoản → **Nâng cao** → **Đi tới Quét giấy tờ (không an toàn)** → **Cho phép**.
   (Cảnh báo này hiện ra vì script do chính bạn viết, chưa qua Google duyệt. Script chỉ tạo thư mục và lưu file vào Drive của bạn.)
6. Bấm **Triển khai** → **Tùy chọn triển khai mới** → bánh răng ⚙ → chọn **Ứng dụng web**:
   - Thực thi với tư cách: **Tôi**
   - Người có quyền truy cập: **Bất kỳ ai**
   Bấm **Triển khai**, chép lại **URL ứng dụng web** (dạng `https://script.google.com/macros/s/.../exec`).

> Ai không có mã bí mật thì không gửi được file vào Drive của bạn, nên đừng chia sẻ mã này.
> Nếu sau này sửa code script: **Triển khai → Quản lý các lần triển khai → ✏ → Phiên bản: Phiên bản mới → Triển khai**. URL giữ nguyên.

---

## Bước 2. Đưa app lên mạng (miễn phí, khoảng 5 phút)

Máy ảnh trên điện thoại chỉ mở được khi trang chạy qua `https://`, nên cần đặt app lên một chỗ có https. Cách dễ nhất là GitHub Pages:

1. Tạo tài khoản tại **https://github.com** (nếu chưa có).
2. Bấm **+** → **New repository**. Tên: `quet-giay-to`, chọn **Public**, bấm **Create repository**.
3. Bấm **uploading an existing file**, kéo thả vào các file trong thư mục `D:\QuetGiayTo`:
   `index.html, style.css, app.js, db.js, vision.js, sw.js, manifest.webmanifest` và **cả thư mục `icons`**.
   (Không cần đưa thư mục `google-apps-script` và file hướng dẫn này.) Bấm **Commit changes**.
4. Vào **Settings → Pages**. Mục *Branch* chọn **main** và **/(root)**, bấm **Save**.
5. Chờ 1–2 phút, trang sẽ có địa chỉ: `https://<tên-tài-khoản>.github.io/quet-giay-to/`

> Trên GitHub chỉ có mã nguồn app. Ảnh giấy tờ, CCCD **không bao giờ** đi qua GitHub: chúng chỉ nằm trên điện thoại và Drive của bạn. Địa chỉ Apps Script và mã bí mật cũng chỉ lưu trên điện thoại.

---

## Bước 3. Cài lên điện thoại

**iPhone:** mở địa chỉ ở bước 2 bằng **Safari** → nút **Chia sẻ** (ô vuông mũi tên lên) → **Thêm vào MH chính**.

**Android:** mở bằng **Chrome** → menu ⋮ → **Cài đặt ứng dụng** (hoặc **Thêm vào màn hình chính**).

Mở app từ biểu tượng mới → bánh răng ⚙ góc trên → dán **URL Apps Script** và **mã bí mật** → **Kiểm tra kết nối**. Thấy dòng "✅ Đã nối được Google Drive" là xong.

Lần mở đầu tiên cần có mạng để tải bộ nhận diện mép giấy (khoảng 10 MB). Từ lần sau app mở được cả khi mất mạng; file quét lúc mất mạng sẽ tự đẩy lên Drive khi có mạng lại.

---

## Cách dùng

- Bấm **Quét**, giơ máy lên trên tờ giấy. Khung xanh hiện ra quanh tờ giấy, chuyển vàng và có chữ **"Giữ yên…"** → app tự chụp, có chớp trắng.
- Lật sang trang khác (hoặc mặt sau CCCD), app tự chụp tiếp. Không cần bấm gì.
- Muốn tự bấm: chạm **Tự động** để đổi sang **Thủ công**, rồi bấm nút tròn trắng.
- Nút ◎ ở trên để chọn bộ lọc: **Màu** (mặc định, giữ màu con dấu đỏ và ảnh chân dung), **Xám**, **Đen trắng** (nhẹ nhất, hợp văn bản chữ), **Ảnh gốc**.
- Bấm **Lưu (n)** để xem lại: vuốt ngang qua các trang; **Cắt** để kéo lại 4 góc (có kính lúp), **Xoay**, đổi **Bộ lọc**, **Xóa** trang.
- Chọn loại: **Giấy chứng nhận / CCCD / Khác**, gõ tên (ví dụ "Nguyễn Văn A - thửa 125 tờ 12") → **Lưu**.
- CCCD: mặc định ghép mặt trước và mặt sau lên **một trang A4, đúng kích thước thật** của thẻ, in ra là dùng được.
- Không có điện thoại trên tay? Nút 🖼 cạnh nút Quét cho chọn ảnh có sẵn trong máy, app vẫn tự tìm mép giấy và nắn thẳng.

Trên Drive, file nằm trong thư mục:

```
Quét giấy tờ/
├── Giấy chứng nhận/   GCN - Nguyễn Văn A - thửa 125 tờ 12 - 06-11-2026 14h05.pdf
├── Căn cước công dân/ CCCD - Nguyễn Văn A - 06-11-2026 14h07.pdf
└── Giấy tờ khác/
```

Mỗi file trong danh sách có nhãn trạng thái: **✓ Đã lên Drive**, **Đang chờ đẩy**, **Chưa đẩy được** (chạm vào để xem lỗi và đẩy lại), **Chỉ trên máy** (chưa cài Drive). Chạm vào file để **Chia sẻ** (gửi Zalo, lưu vào Tệp…), mở trên Drive, đổi tên hoặc xóa khỏi máy.

## Lưu ý

- iPhone không cho web app bật đèn flash. Chỗ tối thì bật thêm đèn phòng. Android có nút đèn.
- Chụp trên nền tối (bàn gỗ, bìa sẫm màu) thì app bắt mép giấy nhanh và chuẩn nhất. Giấy trắng đặt trên bàn trắng sẽ khó nhận.
- **Cài đặt → Xóa trên máy các file đã lên Drive** để giải phóng bộ nhớ điện thoại. Bản trên Drive vẫn còn.
- Xóa app hoặc xóa dữ liệu Safari/Chrome thì các file **chưa** lên Drive sẽ mất theo.
