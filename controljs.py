from selenium import webdriver
from selenium.webdriver.chrome.service import Service
import time
import json

# Khởi tạo browser
options = webdriver.ChromeOptions()
driver = webdriver.Chrome(options=options)

# 1. Mở trang web của bạn
driver.get("ĐỊA_CHỈ_TRANG_WEB_CỦA_BẠN")

# (Tuỳ chọn) Đợi một chút hoặc code đăng nhập để trang load xong bảng
time.sleep(5) 

# 2. Định nghĩa đoạn mã JavaScript (Lưu ý: với execute_async_script, 
# tham số cuối cùng arguments[arguments.length - 1] là hàm callback để trả kết quả về Python)
js_script = """
    // Tham số callback do Selenium tự truyền vào để báo hoàn thành
    var done = arguments[arguments.length - 1]; 

    async function scrapeAllTableData() {
        const scrollContainer = document.querySelector('.overflow-auto');
        if (!scrollContainer) {
            done({error: "Không tìm thấy bảng"});
            return;
        }

        const headers = Array.from(document.querySelectorAll("thead th")).map(th => th.innerText.trim());
        const dataMap = new Map();

        let lastScrollTop = -1;
        let noChangeCount = 0;

        while (true) {
            const rows = document.querySelectorAll("tbody tr");
            for (const tr of rows) {
                const index = tr.getAttribute('data-index');
                if (index && !dataMap.has(index)) {
                    const rowData = Array.from(tr.querySelectorAll("td")).map(td => td.innerText.replace(/\\n/g, ' ').trim());
                    dataMap.set(index, rowData);
                }
            }

            lastScrollTop = scrollContainer.scrollTop;
            scrollContainer.scrollTop += 800; // Mỗi lần cuộn 800px
            
            // Đợi 0.5s để web load data
            await new Promise(r => setTimeout(r, 500));

            if (scrollContainer.scrollTop === lastScrollTop) {
                noChangeCount++;
                if (noChangeCount >= 3) {
                    break; // Đã đến cuối bảng
                }
            } else {
                noChangeCount = 0;
            }
        }

        const rowsArray = Array.from(dataMap.values());
        
        // Gọi hàm done() để gửi toàn bộ dữ liệu trả về cho biến Python
        done({
            headers: headers,
            data: rowsArray,
            total: dataMap.size
        });
    }

    // Thực thi hàm
    scrapeAllTableData();
"""

print("Bắt đầu chạy Javascript cuộn trang lấy dữ liệu (Sẽ mất thời gian tuỳ vào độ dài bảng)...")

# 3. Tăng thời gian chờ timeout của script lên rất cao (vd: 1 tiếng = 3600 giây) 
# vì bảng có 480k dòng sẽ cuộn rất lấu
driver.set_script_timeout(3600)

# 4. Thực thi script JS và nhận kết quả trả về bằng Python
result = driver.execute_async_script(js_script)

if "error" in result:
    print("Lỗi:", result["error"])
else:
    print(f"Hoàn thành! Đã lấy được {result['total']} dòng.")
    
    # 5. Lưu kết quả bằng Python ra file TSV (hoặc CSV)
    with open("du_lieu_bang_tu_selenium.tsv", "w", encoding="utf-8") as f:
        # Ghi Header
        f.write("\\t".join(result["headers"]) + "\\n")
        # Ghi Data
        for row in result["data"]:
            f.write("\\t".join(row) + "\\n")
            
    print("Đã lưu kết quả ra file du_lieu_bang_tu_selenium.tsv")

driver.quit()
