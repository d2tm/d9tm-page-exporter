const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

function logDownloadStatusToCsv(outputPath, fileName, text, status) {
  const csvHeader = "Text,File Name,Status\n";
  const sanitizedText = text.replace(/"/g, '""').replace(/,/g, ";"); // handle quotes
  const sanitizedFileName = fileName;
  const sanitizedStatus = status;
  const line = `${sanitizedText},${sanitizedFileName},${sanitizedStatus}\n`;

  // Write header if file does not exist
  if (!fs.existsSync(outputPath)) {
    fs.writeFileSync(outputPath, csvHeader, { encoding: "utf8" });
  }

  // Append new line
  fs.appendFileSync(outputPath, line, { encoding: "utf8" });
}

(async () => {
  const outputDir = path.resolve(__dirname, "../", process.env.OUTPUT_DIR);
  const reportDir = path.resolve(__dirname, "../", process.env.REPORT_DIR);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }

  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir);
  }

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  const targetURL = process.env.TARGET_URL;
  const regExEnv = process.env.TARGET_REGEX || "";
  console.log(`Target URL: ${targetURL}`);
  console.log(
    `Regex string from env: ${JSON.stringify(process.env.TARGET_REGEX)}`,
  );
  const regEx = new RegExp(regExEnv, "g");
  console.log(`regEx.source:${regEx.source}`);

  await page.goto(targetURL, { waitUntil: "networkidle0" });

  // Find all links with MMM YYYY pattern
  const links = await page.$$eval(
    "div[class*='MainContent'] a",
    (anchors, regExSource) => {
      const pattern = new RegExp(regExSource);
      return anchors
        .filter((a) => pattern.test(a.textContent))
        .map((a) => ({ href: a.href, text: a.textContent.trim() }));
    },
    regEx.source,
  );

  console.log(`Found ${links.length} matching links`);

  let count = 0;
  let status = "";
  for (const link of links) {
    var safeName = `Page_${count}`;
    if (link.text) {
      safeName = link.text
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "_")
        .toUpperCase();
    } else {
      href = link.href;
      if (href.includes("?")) {
        href = href.split("?")[0];
      }
      arr_href = href.split("/");
      safeName = arr_href[arr_href.length - 1].replace(/\.[^/.]+$/, "");
    }
    try {
      const urlObj = new URL(link.href);
      const pdfName = urlObj.searchParams.get("path");
      const filePath = path.join(outputDir, `${safeName}.pdf`);

      if (!urlObj.protocol.includes("http")) {
        console.log(`Skipping non http URL: ${urlObj}`);
        continue;
      } else if (pdfName !== null && pdfName.toLowerCase().includes(".pdf")) {
        console.log(`Skipping: ${pdfName}`);
        continue;
      } else {
        const newPage = await browser.newPage();
        console.log(`Navigating to HTML page: ${link.href}`);
        await newPage.goto(link.href, { waitUntil: "networkidle0" });
        const targetElement = process.env.TARGET_ELEMENT;
        if (targetElement != null && targetElement != "") {
          console.log(`Looking for target element: ${targetElement}`);
          await newPage.waitForSelector(`${targetElement}`);
          const mainContentHTML = await newPage.$eval(
            `${targetElement}`,
            (el) => {
              if (!(el instanceof HTMLElement)) {
                throw new Error("❌ Node is not an HTMLElement");
              }
              return el.outerHTML;
            },
          );

          if (!mainContentHTML || typeof mainContentHTML !== "string") {
            console.error(`❌ Could not extract ${targetElement} HTML`);
            continue;
          }
          const contentPage = await browser.newPage();
          await contentPage.setViewport({ width: 1280, height: 800 });
          await contentPage.setContent(
            `
                    <!DOCTYPE html>
                    <html>
                      <head>
                        <base href="${targetURL}">
                        <meta charset="utf-8">
                        <style>
                          body {
                            font-family: sans-serif;
                            padding: 20px;
                            margin: 0;
                          }
                        </style>
                      </head>
                      <body>
                        ${mainContentHTML}
                      </body>
                    </html>
                  `,
            { waitUntil: "networkidle0" },
          );

          // Generate the PDF
          await contentPage.pdf({
            path: path.join(outputDir, `${safeName}.pdf`),
            format: "A4",
            printBackground: true,
          });
        } else {
          await newPage.pdf({
            path: path.join(outputDir, `${safeName}.pdf`),
            format: "A4",
          });
          await newPage.close();
        }
        count++;
        console.log(`Saved: ${filePath}`);
      }
      status = "success";
    } catch (err) {
      console.error(`Failed to handle link ${link.href}:`, err.message);
      status = "failure";
    }
    logDownloadStatusToCsv(
      `${reportDir}/export_results.csv`,
      `${safeName}.pdf`,
      link.text ? link.text : safeName,
      status,
    );
  }

  console.log(`Saved ${count} PDF(s).`);
  await browser.close();
})();
