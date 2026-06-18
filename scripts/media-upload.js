import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import contentfulManagement from 'contentful-management';
import dotenv from 'dotenv';
import { XMLParser } from 'fast-xml-parser';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const spaceId = process.env.CONTENTFUL_SPACE_ID;
const cmaToken = process.env.CONTENTFUL_MANAGEMENT_TOKEN;
const environmentId = process.env.CONTENTFUL_ENVIRONMENT || 'master';

if (!spaceId || !cmaToken) {
  console.error('Error: CONTENTFUL_SPACE_ID and CONTENTFUL_MANAGEMENT_TOKEN must be set in .env.local or .env');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper to get mime type based on extension
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

// Recursively get files from directory
function getFilesRecursively(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      getFilesRecursively(filePath, fileList);
    } else {
      // Ignore hidden files like .DS_Store
      if (!file.startsWith('.')) {
        fileList.push(filePath);
      }
    }
  }
  return fileList;
}

// Generate deterministic Asset ID using relative path MD5 hash
function generateAssetId(relativePath) {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  const hash = crypto.createHash('md5').update(normalizedPath).digest('hex');
  return `wp_media_${hash}`;
}

// Finds the latest WordPress XML export file under wordpress/content/
function getLatestXmlPath() {
  const contentDir = path.resolve(process.cwd(), 'wordpress/content');
  if (!fs.existsSync(contentDir)) {
    throw new Error(`Directory does not exist: ${contentDir}`);
  }

  const files = fs.readdirSync(contentDir);
  const xmlFiles = files
    .filter(file => /^WordPress\.\d{4}-\d{2}-\d{2}\.xml$/.test(file))
    .map(file => {
      const match = file.match(/^WordPress\.(\d{4}-\d{2}-\d{2})\.xml$/);
      return {
        filename: file,
        filePath: path.join(contentDir, file),
        date: new Date(match[1])
      };
    })
    .filter(item => !isNaN(item.date.getTime()));

  if (xmlFiles.length === 0) {
    throw new Error('No matching WordPress XML files found in wordpress/content/');
  }

  xmlFiles.sort((a, b) => b.date - a.date);
  return xmlFiles[0].filePath;
}

// Parses XML and extracts attachments metadata map
function parseAttachmentsFromXml(xmlPath) {
  console.log(`Parsing XML file for attachment metadata: ${xmlPath}`);
  const xmlContent = fs.readFileSync(xmlPath, 'utf-8');
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseAttributeValue: true
  });
  const jsonObj = parser.parse(xmlContent);

  const items = Array.isArray(jsonObj.rss?.channel?.item) 
    ? jsonObj.rss.channel.item 
    : (jsonObj.rss?.channel?.item ? [jsonObj.rss.channel.item] : []);

  const attachmentMap = {};

  for (const item of items) {
    if (item['wp:post_type'] === 'attachment') {
      const attachmentUrl = item['wp:attachment_url'] || '';
      if (!attachmentUrl) continue;

      // Extract relative path from upload url (e.g. wp-content/uploads/2013/01/img.jpg)
      const match = attachmentUrl.match(/wp-content\/uploads\/(.+)$/);
      if (!match) continue;
      const relativePath = decodeURIComponent(match[1]).replace(/\\/g, '/');

      // Extract description
      let description = '';
      if (typeof item.description === 'string' && item.description.trim()) {
        description = item.description.trim();
      } else if (typeof item['excerpt:encoded'] === 'string' && item['excerpt:encoded'].trim()) {
        description = item['excerpt:encoded'].trim();
      }

      // Check for alt text in postmeta
      const postmetaList = item['wp:postmeta']
        ? (Array.isArray(item['wp:postmeta']) ? item['wp:postmeta'] : [item['wp:postmeta']])
        : [];
      for (const meta of postmetaList) {
        if (meta['wp:meta_key'] === '_wp_attachment_image_alt' && typeof meta['wp:meta_value'] === 'string') {
          const altVal = meta['wp:meta_value'].trim();
          if (altVal) {
            description = description ? `${description} (Alt: ${altVal})` : altVal;
          }
        }
      }

      const title = typeof item.title === 'string' && item.title.trim() 
        ? item.title.trim() 
        : path.basename(relativePath);
      attachmentMap[relativePath] = {
        title,
        description
      };
    }
  }

  // Second pass: scrape alt text from post/page content for missing descriptions
  for (const item of items) {
    const postType = item['wp:post_type'];
    const content = item['content:encoded'];
    if ((postType === 'post' || postType === 'page') && typeof content === 'string' && content.trim()) {
      const imgTags = content.match(/<img[^>]+>/gi) || [];
      for (const tag of imgTags) {
        const srcMatch = tag.match(/src=["']([^"']+)["']/i);
        const altMatch = tag.match(/alt=["']([^"']+)["']/i);
        if (srcMatch && altMatch) {
          const src = srcMatch[1];
          const alt = altMatch[1].trim();
          if (alt) {
            const pathMatch = src.match(/wp-content\/uploads\/(.+?)(?:\?|$)/);
            if (pathMatch) {
              const relPath = decodeURIComponent(pathMatch[1]).replace(/\\/g, '/');
              if (attachmentMap[relPath] && !attachmentMap[relPath].description) {
                attachmentMap[relPath].description = alt;
              }
            }
          }
        }
      }
    }
  }

  console.log(`Extracted metadata for ${Object.keys(attachmentMap).length} attachments.`);
  return attachmentMap;
}

async function uploadMedia() {
  console.log('Connecting to Contentful...');
  const client = contentfulManagement.createClient({
    accessToken: cmaToken,
  });

  const space = await client.getSpace(spaceId);
  const environment = await space.getEnvironment(environmentId);

  const locales = await environment.getLocales();
  const defaultLocale = process.env.CONTENTFUL_LOCALE || locales.items.find((l) => l.default).code;

  console.log(`Target Space: ${spaceId}`);
  console.log(`Target Environment: ${environmentId}`);
  console.log(`Default Locale: ${defaultLocale}`);

  // Resolve and parse latest XML file to get descriptions
  let attachmentMetadata = {};
  try {
    const latestXmlPath = getLatestXmlPath();
    attachmentMetadata = parseAttachmentsFromXml(latestXmlPath);
  } catch (err) {
    console.warn(`Warning: Could not parse XML for attachment descriptions (${err.message}). Uploading without description fallback.`);
  }

  const mediaDir = path.resolve(process.cwd(), 'wordpress/media');
  if (!fs.existsSync(mediaDir)) {
    console.error(`Error: Media directory not found at ${mediaDir}`);
    process.exit(1);
  }

  console.log('\nScanning wordpress/media directory...');
  const allFiles = getFilesRecursively(mediaDir);
  console.log(`Found ${allFiles.length} files in wordpress/media.`);

  let successCount = 0;
  let skipCount = 0;

  for (let i = 0; i < allFiles.length; i++) {
    const filePath = allFiles[i];
    const relativePath = path.relative(mediaDir, filePath).replace(/\\/g, '/');
    const assetId = generateAssetId(relativePath);
    const fileName = path.basename(filePath);
    const mimeType = getMimeType(filePath);

    // Skip 0-byte files
    const stats = fs.statSync(filePath);
    if (stats.size === 0) {
      console.log(`\n[${i + 1}/${allFiles.length}] Skipping 0-byte file: ${relativePath}`);
      skipCount++;
      continue;
    }

    // Get metadata from XML extraction
    const meta = attachmentMetadata[relativePath] || { title: fileName, description: '' };

    console.log(`\n[${i + 1}/${allFiles.length}] Processing: ${relativePath}`);
    console.log(`Computed Asset ID: ${assetId}`);
    if (meta.description) {
      console.log(`Metadata Description: ${meta.description}`);
    }

    try {
      // Check if asset already exists
      let asset;
      try {
        asset = await environment.getAsset(assetId);
        if (asset.isPublished()) {
          console.log(`Asset already exists and is published. Skipping upload.`);
          skipCount++;
          continue;
        }
        console.log(`Asset exists but is not published. Proceeding to publish...`);
      } catch (err) {
        // Asset does not exist, upload and create
        console.log(`Uploading file...`);
        const upload = await environment.createUpload({
          file: fs.createReadStream(filePath),
        });

        console.log(`Creating asset...`);
        asset = await environment.createAssetWithId(assetId, {
          fields: {
            title: {
              [defaultLocale]: meta.title,
            },
            description: {
              [defaultLocale]: meta.description,
            },
            file: {
              [defaultLocale]: {
                contentType: mimeType,
                fileName: fileName,
                uploadFrom: {
                  sys: {
                    type: 'Link',
                    linkType: 'Upload',
                    id: upload.sys.id,
                  },
                },
              },
            },
          },
        });
      }

      // Process asset
      console.log(`Processing asset for locale ${defaultLocale}...`);
      asset = await asset.processForLocale(defaultLocale);

      // Wait until processed
      let processed = false;
      let checkAttempts = 0;
      while (!processed && checkAttempts < 10) {
        const checkAsset = await environment.getAsset(assetId);
        if (checkAsset.fields.file[defaultLocale]?.url) {
          processed = true;
          asset = checkAsset;
        } else {
          checkAttempts++;
          console.log(`Waiting for asset processing (attempt ${checkAttempts}/10)...`);
          await sleep(200);
        }
      }

      if (!processed) {
        throw new Error('Asset processing timed out');
      }

      // Publish asset
      console.log(`Publishing asset...`);
      await asset.publish();
      console.log(`Successfully published asset: ${assetId}`);
      successCount++;
    } catch (err) {
      console.error(`Failed to process/upload asset ${relativePath}:`, err.message);
    }
  }

  console.log(`\nMedia upload completed!`);
  console.log(`Successfully processed: ${successCount}`);
  console.log(`Skipped (already published): ${skipCount}`);
  console.log(`Failed: ${allFiles.length - successCount - skipCount}`);
}

uploadMedia().catch((err) => {
  console.error('An error occurred during media upload:', err);
  process.exit(1);
});
