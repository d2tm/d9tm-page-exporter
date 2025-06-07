const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const axios = require("axios");
const https = require('https');

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

async function downloadImage(url, filePath, outputDir, cookieArray = []) {
  console.log(`Attempting to download ${url}`);
  // Convert cookie array to a single "Cookie" header string
  const cookieHeader = cookieArray
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  console.log(`axios obj: ${axios}`)
  const httpsAgent = new https.Agent({
    rejectUnauthorized: false, // ⚠️ disables SSL cert validation
  });
  const response = await axios.get(url, {
    responseType: "stream",
    headers: {
      Cookie: cookieHeader,
    },
    maxRedirects: 5, // In case image URLs redirect
    httpsAgent
  });
  console.log(`Received image response ${response}`);
  const writer = fs.createWriteStream(`${outputDir}/${filePath}`);

  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
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
  const context = browser.defaultBrowserContext();
  const page = await context.newPage();
  const targetURL = process.env.TARGET_URL;
  const regExEnv = process.env.TARGET_REGEX || "";
  console.log(`Target URL: ${targetURL}`);
  console.log(
    `Regex string from env: ${JSON.stringify(process.env.TARGET_REGEX)}`
  );
  const regEx = new RegExp(regExEnv, "g");
  console.log(`regEx.source:${regEx.source}`);

  // Check if cookies need to be set
  const cookieNames = process.env.COOKIE_NAMES;
  const cookieValues = process.env.COOKIE_VALUES;
  const cookieDomain = process.env.COOKIE_DOMAIN;
  // Calculate expiry: now + 24 hours (in seconds)
  const cookieExpires = Math.floor(Date.now() / 1000) + 86400;
  console.log(`Expires: ${new Date(cookieExpires * 1000)}`);

  if (cookieNames != null && cookieValues != null && cookieDomain != null) {
    const cookieNamesArr = cookieNames.split(/[\s,]+/);
    const cookieValuesArr = cookieValues.split(/[\s,]+/);
    for (i = 0; i < cookieNamesArr.length; i++) {
      // Set a cookie that expires in 24 hours
      console.log(`Setting cookie: ${cookieNamesArr[i]}`);
      page.setCookie({
        name: cookieNamesArr[i],
        value: cookieValuesArr[i],
        domain: cookieDomain,
        path: "/",
        httpOnly: false,
        secure: true,
        sameSite: "None",
        expires: cookieExpires,
      });
    }
  }

  await page.goto(targetURL, { waitUntil: "networkidle0", timeout: 120000 });

  // Reload page with cookie
  await page.reload({ waitUntil: "networkidle0", timeout: 120000 });

  // Debug: print cookies
  const cookies = await context.cookies(targetURL);
  console.log("Cookies:", cookies);

  const sourceImagesRef = process.env.SOURCE_IMAGES_REF;
  // Find all images that match the pattern
  const images = await page.$$eval(
    sourceImagesRef,
    (images, regExSource) => {
      const pattern = new RegExp(regExSource);
      console.log(`Matching ${images} with pattern ${regExSource}`);
      return images
        .filter((img) => pattern.test(img.title))
        .map((img) => ({ src: img.src, title: img.title.trim() }));
    },
    regEx.source
  );

  console.log(`Found ${images.length} matching images`);

  let count = 0;
  let status = "";
  for (const image of images) {
    imageSrc = image.src;
    if (!imageSrc.includes("http")) {
      targetURL = new URL(targetURL);
      imageSrc = `${targetURL.protocol}//${targetURL.host}/${imageSrc}`;
    }
    const urlObj = new URL(imageSrc);
    var safeName = urlObj.pathname.substring(urlObj.pathname.lastIndexOf("/"));
    if (image.title) {
      const match = image.title.match(/FILE NAME:\s*(\S+)/);
      if (match) {
        console.log("Image name from title:", match[1]); // → commskillsthumbnail.jpg
        safeName = match[1];
      }
    }
    try {
      await downloadImage(imageSrc, safeName, outputDir, cookies);
      count++;
      status = "success";
    } catch (err) {
      console.error(`Failed to handle image ${image.src}:`, err.message);
      status = "failure";
    }
    logDownloadStatusToCsv(
      `${reportDir}/export_results.csv`,
      safeName,
      safeName,
      status
    );
  }

  console.log(`Saved ${count} images(s).`);
  await browser.close();
})();
