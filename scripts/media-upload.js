import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import contentfulManagement from 'contentful-management';
import dotenv from 'dotenv';

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
  // Replace slashes/backslashes to ensure uniformity across platforms
  const normalizedPath = relativePath.replace(/\\/g, '/');
  const hash = crypto.createHash('md5').update(normalizedPath).digest('hex');
  return `wp_media_${hash}`;
}

async function uploadMedia() {
  console.log('Connecting to Contentful...');
  const client = contentfulManagement.createClient({
    accessToken: cmaToken,
  });

  const space = await client.getSpace(spaceId);
  const environment = await space.getEnvironment(environmentId);

  const locales = await environment.getLocales();
  const defaultLocale = locales.items.find((l) => l.default).code;

  console.log(`Target Space: ${spaceId}`);
  console.log(`Target Environment: ${environmentId}`);
  console.log(`Default Locale: ${defaultLocale}`);

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
    const relativePath = path.relative(mediaDir, filePath);
    const assetId = generateAssetId(relativePath);
    const fileName = path.basename(filePath);
    const mimeType = getMimeType(filePath);

    console.log(`\n[${i + 1}/${allFiles.length}] Processing: ${relativePath}`);
    console.log(`Computed Asset ID: ${assetId}`);

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
              [defaultLocale]: fileName,
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
        await sleep(350);
      }

      // Process asset
      console.log(`Processing asset for locale ${defaultLocale}...`);
      asset = await asset.processForLocale(defaultLocale);
      await sleep(500);

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
          await sleep(1500);
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
      
      // Delay to respect rate limits
      await sleep(350);
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
