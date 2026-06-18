import fs from 'fs';
import path from 'path';
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

/**
 * Finds the latest WordPress XML export file under wordpress/content/
 * based on the YYYY-MM-DD date in the filename (e.g. WordPress.2026-06-16.xml).
 * 
 * @returns {string} The absolute path to the latest XML file.
 */
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
    throw new Error('No matching WordPress XML files (WordPress.YYYY-MM-DD.xml) found in wordpress/content/');
  }

  // Sort descending by date to get the latest first
  xmlFiles.sort((a, b) => b.date - a.date);

  return xmlFiles[0].filePath;
}

async function getOrCreateContentType(environment, id, name, fields, displayField) {
  try {
    let contentType = await environment.getContentType(id);
    console.log(`Content Type "${id}" already exists. Updating fields...`);
    contentType.fields = fields;
    contentType.displayField = displayField;
    contentType = await contentType.update();
    await sleep(350);
    contentType = await contentType.publish();
    console.log(`Published Content Type "${id}".`);
    await sleep(350);
    return contentType;
  } catch (err) {
    // Content Type not found, create new one
    console.log(`Creating Content Type "${id}"...`);
    let contentType = await environment.createContentTypeWithId(id, {
      name,
      displayField,
      fields
    });
    await sleep(350);
    contentType = await contentType.publish();
    console.log(`Published new Content Type "${id}".`);
    await sleep(350);
    return contentType;
  }
}

async function setupContentTypes(environment) {
  // 1. Category Content Type
  const categoryFields = [
    {
      id: 'name',
      name: 'Name',
      type: 'Symbol',
      required: true
    },
    {
      id: 'slug',
      name: 'Slug',
      type: 'Symbol',
      required: true,
      validations: [{ unique: true }]
    }
  ];

  // 2. Tag Content Type
  const tagFields = [
    {
      id: 'name',
      name: 'Name',
      type: 'Symbol',
      required: true
    },
    {
      id: 'slug',
      name: 'Slug',
      type: 'Symbol',
      required: true,
      validations: [{ unique: true }]
    }
  ];

  // 3. Blog Post Content Type
  const blogPostFields = [
    {
      id: 'title',
      name: 'Title',
      type: 'Symbol',
      required: true
    },
    {
      id: 'slug',
      name: 'Slug',
      type: 'Symbol',
      required: true,
      validations: [{ unique: true }]
    },
    {
      id: 'content',
      name: 'Content',
      type: 'RichText'
    },
    {
      id: 'excerpt',
      name: 'Excerpt',
      type: 'Text'
    },
    {
      id: 'publishDate',
      name: 'Publish Date',
      type: 'Date'
    },
    {
      id: 'categories',
      name: 'Categories',
      type: 'Array',
      items: {
        type: 'Link',
        linkType: 'Entry',
        validations: [
          {
            linkContentType: ['category']
          }
        ]
      }
    },
    {
      id: 'tags',
      name: 'Tags',
      type: 'Array',
      items: {
        type: 'Link',
        linkType: 'Entry',
        validations: [
          {
            linkContentType: ['tag']
          }
        ]
      }
    },
    {
      id: 'featuredImage',
      name: 'Featured Image',
      type: 'Link',
      linkType: 'Asset'
    },
    {
      id: 'status',
      name: 'Status',
      type: 'Symbol'
    },
    {
      id: 'wordpressId',
      name: 'WordPress ID',
      type: 'Integer'
    }
  ];

  console.log('Setting up Content Types...');
  await getOrCreateContentType(environment, 'category', 'Category', categoryFields, 'name');
  await getOrCreateContentType(environment, 'tag', 'Tag', tagFields, 'name');
  await getOrCreateContentType(environment, 'blogPost', 'Blog Post', blogPostFields, 'title');
  console.log('Content Types setup finished successfully!');
}

async function main() {
  try {
    console.log('Connecting to Contentful...');
    const client = contentfulManagement.createClient({
      accessToken: cmaToken,
    });

    const space = await client.getSpace(spaceId);
    const environment = await space.getEnvironment(environmentId);

    console.log(`Target Space: ${spaceId}`);
    console.log(`Target Environment: ${environmentId}\n`);

    // Ensure content types are set up in Contentful
    await setupContentTypes(environment);

    const latestXmlPath = getLatestXmlPath();
    console.log(`\nLatest XML file found: ${latestXmlPath}`);
    
    const stats = fs.statSync(latestXmlPath);
    console.log(`File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log('Successfully resolved and accessed the latest WordPress XML export file.');
  } catch (error) {
    console.error('Error during setup execution:', error.message);
    process.exit(1);
  }
}

main();
