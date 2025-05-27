const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

function logDownloadStatusToCsv(outputPath, fileName, text, status) {
  const csvHeader = "Text,File Name,Status\n";
  const sanitizedText = text.replace(/"/g, '""'); // handle quotes
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
  const outputDir = path.resolve(
    __dirname,
    "../",
    process.env.NEWSLETTERS_OUTPUT_DIR,
  );
  const reportDir = path.resolve(
    __dirname,
    "../",
    process.env.NEWSLETTERS_REPORT_DIR,
  );

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
  const targetURL = process.env.NEWSLETTERS_URL;
  const regExEnv = process.env.NEWSLETTERS_REGEX || "";
  console.log(
    `Regex string from env: ${JSON.stringify(process.env.NEWSLETTERS_REGEX)}`,
  );
  const regEx = new RegExp(regExEnv, "g");
  console.log(`regEx.source:${regEx.source}`);

  await page.goto(targetURL, { waitUntil: "networkidle2" });

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
    const safeName = link.text
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "_")
      .toUpperCase();
    try {
      const urlObj = new URL(link.href);
      const pdfName = urlObj.searchParams.get("path");
      const filePath = path.join(outputDir, `${safeName}.pdf`);

      if (pdfName !== null && pdfName.toLowerCase().includes(".pdf")) {
        console.log(`Skipping: ${pdfName}`);
        continue
      } else {
        const newPage = await browser.newPage();
        console.log(`Navigating to HTML page: ${link.href}`);
        await newPage.goto(link.href, { waitUntil: "networkidle2" });
        await newPage.pdf({ path: filePath, format: "A4" });
        await newPage.close();
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
      link.text,
      status,
    );
  }

  console.log(`Saved ${count} PDF(s).`);
  await browser.close();
})();
