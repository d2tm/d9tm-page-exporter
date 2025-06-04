package main

import (
	"encoding/csv"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"regexp"
	"strings"

	"golang.org/x/net/html"
)

type LinkInfo struct {
	URL  string
	Text string
}

var (
	yearRegex = regexp.MustCompile(os.Getenv("TARGET_REGEX"))
)

func main() {
	pageURL := os.Getenv("TARGET_URL")
	outputDir := "../../" + os.Getenv("OUTPUT_DIR")
	reportDir := "../../" + os.Getenv("REPORT_DIR")

	err := os.MkdirAll(outputDir, 0755)
	if err != nil {
		fmt.Println("Error creating output folder:", err)
		return
	}

	linkInfos, err := extractLinks(pageURL)
	fmt.Printf("Found %d PDF download urls", len(linkInfos))
	if err != nil {
		fmt.Println("Error extracting links:", err)
		return
	}

	exportResultsCSV := reportDir + "/export_results.csv"
	status := ""
	for _, linkInfo := range linkInfos {
		if !strings.HasSuffix(strings.ToLower(linkInfo.URL), ".pdf") {
			continue
		}

		if !yearRegex.MatchString(linkInfo.Text) {
			continue
		}

		fileName, err := downloadPDF(linkInfo.URL, outputDir)
		status = "success"

		if err != nil {
			fmt.Printf("Failed to download %s: %v\n", linkInfo.URL, err)
			status = "failure. " + err.Error()
		}

		logDownloadStatus(exportResultsCSV, fileName, status, linkInfo.Text)
	}
}

func extractLinks(pageURL string) ([]LinkInfo, error) {
	resp, err := http.Get(pageURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	z := html.NewTokenizer(resp.Body)
	var links []LinkInfo
	inMainContent := false
	divDepth := 0
	var currentHref string
	var captureText bool

	for {
		tt := z.Next()
		switch tt {
		case html.ErrorToken:
			return links, nil

		case html.StartTagToken:
			t := z.Token()
			if t.Data == "div" {
				for _, a := range t.Attr {
					if a.Key == "class" && a.Val == "MainContent" {
						inMainContent = true
						divDepth = 1
						break
					}
				}
				if inMainContent && divDepth > 0 && t.Data == "div" {
					divDepth++
				}
			}

			if inMainContent && t.Data == "a" {
				for _, a := range t.Attr {
					if a.Key == "href" {
						link := resolveURL(pageURL, a.Val)
						if link != "" && hasPDFPathParam(link) {
							currentHref = link
							captureText = true
						}
					}
				}
			}

		case html.TextToken:
			if captureText && currentHref != "" {
				text := strings.TrimSpace(string(z.Text()))
				if !yearRegex.MatchString(text) {
					continue
				}
				if text != "" {
					links = append(links, LinkInfo{
						URL:  currentHref,
						Text: text,
					})
					currentHref = ""
					captureText = false
				}
			}

		case html.EndTagToken:
			t := z.Token()
			if inMainContent && t.Data == "div" {
				divDepth--
				if divDepth == 0 {
					inMainContent = false
				}
			}
			if t.Data == "a" {
				captureText = false
			}
		}
	}
}

func hasPDFPathParam(link string) bool {
	parsed, err := url.Parse(link)
	if err != nil {
		return false
	}
	pathParam := parsed.Query().Get("path")
	return strings.HasSuffix(strings.ToLower(pathParam), ".pdf")
}

func resolveURL(base, ref string) string {
	baseURL, err := url.Parse(base)
	if err != nil {
		return ""
	}
	refURL, err := url.Parse(ref)
	if err != nil {
		return ""
	}
	return baseURL.ResolveReference(refURL).String()
}

func downloadPDF(fileURL, outputDir string) (string, error) {
	resp, err := http.Get(fileURL)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("bad status: %s", resp.Status)
	}

	fileName := resp.Request.URL.Query().Get("path")
	outputPath := path.Join(outputDir, fileName)

	fmt.Printf("Downloading %s to %s\n", fileName, outputPath)

	outFile, err := os.Create(outputPath)
	if err != nil {
		return fileName, err
	}
	defer outFile.Close()

	_, err = io.Copy(outFile, resp.Body)
	return fileName, err
}

func logDownloadStatus(csvPath, fileName, status, text string) error {
	// Open or create the CSV file in append mode
	file, err := os.OpenFile(csvPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer file.Close()

	writer := csv.NewWriter(file)
	defer writer.Flush()

	record := []string{
		text,     // Link Text
		fileName, // File Name
		status,   // "SUCCESS" or "FAIL"
	}

	return writer.Write(record)
}
