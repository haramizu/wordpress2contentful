import contentfulManagement from 'contentful-management';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local and .env
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const spaceId = process.env.CONTENTFUL_SPACE_ID;
const cmaToken = process.env.CONTENTFUL_MANAGEMENT_TOKEN;
const environmentId = process.env.CONTENTFUL_ENVIRONMENT || 'master';

if (!spaceId || !cmaToken) {
  console.error('Error: CONTENTFUL_SPACE_ID and CONTENTFUL_MANAGEMENT_TOKEN must be set in .env.local or .env');
  process.exit(1);
}

const isConfirmed = process.argv.includes('--confirm');
const keepAssets = process.argv.includes('--keep-assets') || process.argv.includes('--keep-media');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A simple concurrency helper pool
async function asyncPool(concurrency, array, iteratorFn) {
  const ret = [];
  const executing = [];
  for (const item of array) {
    const p = Promise.resolve().then(() => iteratorFn(item, array));
    ret.push(p);
    if (concurrency <= array.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= concurrency) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(ret);
}

async function cleanup() {
  console.log(`Connecting to Contentful...`);
  const client = contentfulManagement.createClient({
    accessToken: cmaToken,
  });

  const space = await client.getSpace(spaceId);
  const environment = await space.getEnvironment(environmentId);

  console.log(`Target Space: ${spaceId}`);
  console.log(`Target Environment: ${environmentId}`);

  if (!isConfirmed) {
    console.log('\n⚠️  WARNING: This script will delete ALL entries and assets in the targeted Contentful environment.');
    console.log('To execute this deletion, please run:');
    console.log('  npm run cleanup -- --confirm');
    process.exit(0);
  }

  console.log('\nStarting cleanup process with concurrency...');

  // --- Clean Up Entries ---
  console.log('\nFetching entries...');
  let entries = [];
  let skip = 0;
  const limit = 100;
  while (true) {
    const response = await environment.getEntries({ skip, limit });
    entries.push(...response.items);
    if (response.items.length < limit) break;
    skip += limit;
  }
  console.log(`Found ${entries.length} entries.`);

  let entryCount = 0;
  await asyncPool(2, entries, async (entry) => {
    const current = ++entryCount;
    try {
      if (entry.isPublished()) {
        console.log(`[${current}/${entries.length}] Unpublishing entry: ${entry.sys.id}`);
        await entry.unpublish();
        await sleep(350);
      }
      console.log(`[${current}/${entries.length}] Deleting entry: ${entry.sys.id}`);
      await entry.delete();
      await sleep(350);
    } catch (err) {
      console.error(`Failed to delete entry ${entry.sys.id}:`, err.message);
    }
  });

  // --- Clean Up Assets ---
  if (keepAssets) {
    console.log('\nSkipping asset (media) cleanup (--keep-media flag set).');
  } else {
    console.log('\nFetching assets...');
    let assets = [];
    skip = 0;
    while (true) {
      const response = await environment.getAssets({ skip, limit });
      assets.push(...response.items);
      if (response.items.length < limit) break;
      skip += limit;
    }
    console.log(`Found ${assets.length} assets.`);

    let assetCount = 0;
    await asyncPool(2, assets, async (asset) => {
      const current = ++assetCount;
      try {
        if (asset.isPublished()) {
          console.log(`[${current}/${assets.length}] Unpublishing asset: ${asset.sys.id}`);
          await asset.unpublish();
          await sleep(350);
        }
        console.log(`[${current}/${assets.length}] Deleting asset: ${asset.sys.id}`);
        await asset.delete();
        await sleep(350);
      } catch (err) {
        console.error(`Failed to delete asset ${asset.sys.id}:`, err.message);
      }
    });
  }

  // --- Clean Up Content Types ---
  console.log('\nFetching content types...');
  let contentTypes = [];
  skip = 0;
  while (true) {
    const response = await environment.getContentTypes({ skip, limit });
    contentTypes.push(...response.items);
    if (response.items.length < limit) break;
    skip += limit;
  }
  console.log(`Found ${contentTypes.length} content types.`);

  let contentTypeCount = 0;
  await asyncPool(2, contentTypes, async (contentType) => {
    const current = ++contentTypeCount;
    try {
      if (contentType.isPublished()) {
        console.log(`[${current}/${contentTypes.length}] Unpublishing content type: ${contentType.sys.id}`);
        await contentType.unpublish();
        await sleep(350);
      }
      console.log(`[${current}/${contentTypes.length}] Deleting content type: ${contentType.sys.id}`);
      await contentType.delete();
      await sleep(350);
    } catch (err) {
      console.error(`Failed to delete content type ${contentType.sys.id}:`, err.message);
    }
  });

  console.log('\nCleanup finished successfully!');
}

cleanup().catch((err) => {
  console.error('An error occurred during cleanup:', err);
  process.exit(1);
});
