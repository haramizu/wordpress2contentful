import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import contentfulManagement from 'contentful-management';
import dotenv from 'dotenv';
import { XMLParser } from 'fast-xml-parser';
import { parse as parseHtml } from 'node-html-parser';

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

// Generate deterministic ID using MD5 hash
function generateDeterministicId(prefix, key) {
  const hash = crypto.createHash('md5').update(key.trim()).digest('hex');
  return `${prefix}_${hash}`;
}

// Simple concurrency helper pool
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

function convertHtmlToRichText(htmlContent, attachmentIdToAssetId) {
  // Strip comments (including Gutenberg comment blocks)
  const cleanHtml = htmlContent.replace(/<!--[\s\S]*?-->/g, '').trim();
  if (!cleanHtml) {
    return {
      nodeType: 'document',
      data: {},
      content: [
        {
          nodeType: 'paragraph',
          data: {},
          content: [{ nodeType: 'text', value: '', marks: [], data: {} }]
        }
      ]
    };
  }

  const root = parseHtml(cleanHtml);

  const convertDomToBlocks = (nodes) => {
    const blocks = [];
    let inlineBuffer = [];

    const flushInlineBuffer = () => {
      if (inlineBuffer.length > 0) {
        const isJustWhitespace = inlineBuffer.every(n => n.nodeType === 'text' && !n.value.trim());
        if (!isJustWhitespace) {
          blocks.push({
            nodeType: 'paragraph',
            data: {},
            content: [...inlineBuffer]
          });
        }
        inlineBuffer = [];
      }
    };

    const convertNodeToInlines = (node, parentMarks = []) => {
      const marks = [...parentMarks];
      if (node.nodeType === 3) {
        const textVal = node.text;
        if (textVal) {
          const uniqueMarks = Array.from(new Set(marks.map(m => m.type))).map(type => ({ type }));
          return [{
            nodeType: 'text',
            value: textVal,
            marks: uniqueMarks,
            data: {}
          }];
        }
        return [];
      }

      if (node.nodeType === 1) {
        const tagName = node.tagName.toLowerCase();
        if (tagName === 'strong' || tagName === 'b') {
          marks.push({ type: 'bold' });
        } else if (tagName === 'em' || tagName === 'i') {
          marks.push({ type: 'italic' });
        } else if (tagName === 'u') {
          marks.push({ type: 'underline' });
        } else if (tagName === 'code') {
          marks.push({ type: 'code' });
        }

        if (tagName === 'a') {
          const inlines = [];
          for (const child of node.childNodes) {
            inlines.push(...convertNodeToInlines(child, marks));
          }
          return [{
            nodeType: 'hyperlink',
            data: { uri: node.getAttribute('href') || '' },
            content: inlines.length > 0 ? inlines : [{ nodeType: 'text', value: '', marks: [], data: {} }]
          }];
        }

        if (tagName === 'img') {
          return [];
        }

        if (tagName === 'br') {
          const uniqueMarks = Array.from(new Set(marks.map(m => m.type))).map(type => ({ type }));
          return [{
            nodeType: 'text',
            value: '\n',
            marks: uniqueMarks,
            data: {}
          }];
        }

        const result = [];
        for (const child of node.childNodes) {
          result.push(...convertNodeToInlines(child, marks));
        }
        return result;
      }

      return [];
    };

    const processNode = (node) => {
      if (node.nodeType === 3) {
        const textVal = node.text;
        if (textVal) {
          inlineBuffer.push({
            nodeType: 'text',
            value: textVal,
            marks: [],
            data: {}
          });
        }
        return;
      }

      if (node.nodeType === 1) {
        const tagName = node.tagName.toLowerCase();

        if (tagName === 'img') {
          flushInlineBuffer();
          const src = node.getAttribute('src') || '';
          let assetId = null;
          if (src) {
            const match = src.match(/wp-content\/uploads\/(.+?)(?:\?|$)/);
            if (match) {
              const relativePath = decodeURIComponent(match[1]).replace(/\\/g, '/');
              const hash = crypto.createHash('md5').update(relativePath).digest('hex');
              assetId = `wp_media_${hash}`;
            }
          }
          if (assetId) {
            blocks.push({
              nodeType: 'embedded-asset-block',
              data: {
                target: {
                  sys: {
                    type: 'Link',
                    linkType: 'Asset',
                    id: assetId
                  }
                }
              },
              content: []
            });
          }
          return;
        }

        if (['strong', 'b', 'em', 'i', 'u', 'code', 'span', 'a'].includes(tagName)) {
          inlineBuffer.push(...convertNodeToInlines(node, []));
          return;
        }

        if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote', 'div'].includes(tagName)) {
          flushInlineBuffer();

          if (tagName === 'p' || tagName === 'div') {
            const hasBlockChildren = node.childNodes.some(child => 
              child.nodeType === 1 && 
              ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote', 'div', 'img'].includes(child.tagName.toLowerCase())
            );

            if (hasBlockChildren) {
              blocks.push(...convertDomToBlocks(node.childNodes));
            } else {
              const inlines = [];
              for (const child of node.childNodes) {
                inlines.push(...convertNodeToInlines(child, []));
              }
              if (inlines.length > 0) {
                blocks.push({
                  nodeType: 'paragraph',
                  data: {},
                  content: inlines
                });
              }
            }
          } else if (tagName.startsWith('h')) {
            const headingNum = tagName.substring(1);
            const inlines = [];
            for (const child of node.childNodes) {
              inlines.push(...convertNodeToInlines(child, []));
            }
            blocks.push({
              nodeType: ['1', '2', '3', '4', '5', '6'].includes(headingNum) ? `heading-${headingNum}` : 'heading-1',
              data: {},
              content: inlines.length > 0 ? inlines : [{ nodeType: 'text', value: '', marks: [], data: {} }]
            });
          } else if (tagName === 'blockquote') {
            const childBlocks = convertDomToBlocks(node.childNodes);
            const blockquoteBlocks = childBlocks.filter(b => b.nodeType === 'paragraph');
            blocks.push({
              nodeType: 'blockquote',
              data: {},
              content: blockquoteBlocks.length > 0 ? blockquoteBlocks : [{
                nodeType: 'paragraph',
                data: {},
                content: [{ nodeType: 'text', value: '', marks: [], data: {} }]
              }]
            });
          } else if (tagName === 'ul' || tagName === 'ol') {
            const listItems = [];
            for (const child of node.childNodes) {
              if (child.nodeType === 1 && child.tagName.toLowerCase() === 'li') {
                const childBlocks = convertDomToBlocks(child.childNodes);
                const contentBlocks = childBlocks.length > 0 ? childBlocks : [{
                  nodeType: 'paragraph',
                  data: {},
                  content: [{ nodeType: 'text', value: '', marks: [], data: {} }]
                }];
                listItems.push({
                  nodeType: 'list-item',
                  data: {},
                  content: contentBlocks
                });
              }
            }
            blocks.push({
              nodeType: tagName === 'ul' ? 'unordered-list' : 'ordered-list',
              data: {},
              content: listItems
            });
          }
          return;
        }

        const hasBlockChildren = node.childNodes.some(child => 
          child.nodeType === 1 && 
          ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote', 'div', 'img'].includes(child.tagName.toLowerCase())
        );
        if (hasBlockChildren) {
          flushInlineBuffer();
          blocks.push(...convertDomToBlocks(node.childNodes));
        } else {
          for (const child of node.childNodes) {
            processNode(child);
          }
        }
      }
    };

    for (const node of nodes) {
      processNode(node);
    }
    flushInlineBuffer();

    return blocks;
  };

  const blocks = convertDomToBlocks(root.childNodes);

  return {
    nodeType: 'document',
    data: {},
    content: blocks.length > 0 ? blocks : [{
      nodeType: 'paragraph',
      data: {},
      content: [{ nodeType: 'text', value: '', marks: [], data: {} }]
    }]
  };
}

async function uploadContent() {
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

  // Resolve and parse latest XML file
  const latestXmlPath = getLatestXmlPath();
  console.log(`\nParsing WXR XML file: ${latestXmlPath}`);
  const xmlContent = fs.readFileSync(latestXmlPath, 'utf-8');
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseAttributeValue: true
  });
  const jsonObj = parser.parse(xmlContent);

  const items = Array.isArray(jsonObj.rss?.channel?.item) 
    ? jsonObj.rss.channel.item 
    : (jsonObj.rss?.channel?.item ? [jsonObj.rss.channel.item] : []);

  const categoriesFromXml = Array.isArray(jsonObj.rss?.channel?.['wp:category'])
    ? jsonObj.rss.channel['wp:category']
    : (jsonObj.rss?.channel?.['wp:category'] ? [jsonObj.rss.channel['wp:category']] : []);

  const tagsFromXml = Array.isArray(jsonObj.rss?.channel?.['wp:tag'])
    ? jsonObj.rss.channel['wp:tag']
    : (jsonObj.rss?.channel?.['wp:tag'] ? [jsonObj.rss.channel['wp:tag']] : []);

  console.log(`Found XML definitions: ${categoriesFromXml.length} categories, ${tagsFromXml.length} tags, ${items.length} items.`);

  // Maps for resolving dependencies
  const categoryMap = {}; // slug -> entry ID
  const tagMap = {};      // slug -> entry ID
  const attachmentIdToAssetId = {}; // wp:post_id -> Contentful Asset ID

  // 1. Process Categories
  console.log('\n--- Processing Categories ---');
  const uniqueCategories = new Map();
  // Read defined categories
  for (const cat of categoriesFromXml) {
    const name = cat['wp:cat_name'] || '';
    const slug = cat['wp:category_nicename'] || '';
    if (name && slug) {
      uniqueCategories.set(slug, { name, slug });
    }
  }

  let catCount = 0;
  const catArray = Array.from(uniqueCategories.values());
  await asyncPool(2, catArray, async (cat) => {
    const current = ++catCount;
    const catId = generateDeterministicId('wp_cat', cat.slug);
    categoryMap[cat.slug] = catId;
    try {
      let entry;
      try {
        entry = await environment.getEntry(catId);
        console.log(`[${current}/${catArray.length}] Category already exists: ${cat.name} (${catId})`);
      } catch (err) {
        console.log(`[${current}/${catArray.length}] Creating Category: ${cat.name} (${catId})`);
        entry = await environment.createEntryWithId('category', catId, {
          fields: {
            name: { [defaultLocale]: cat.name },
            slug: { [defaultLocale]: cat.slug }
          }
        });
      }
      if (!entry.isPublished()) {
        await entry.publish();
        await sleep(350);
      }
    } catch (err) {
      console.error(`Failed to process category ${cat.name}:`, err.message);
    }
  });

  // 2. Process Tags
  console.log('\n--- Processing Tags ---');
  const uniqueTags = new Map();
  for (const tag of tagsFromXml) {
    const name = tag['wp:tag_name'] || '';
    const slug = tag['wp:tag_slug'] || '';
    if (name && slug) {
      uniqueTags.set(slug, { name, slug });
    }
  }

  let tagCount = 0;
  const tagArray = Array.from(uniqueTags.values());
  await asyncPool(2, tagArray, async (tag) => {
    const current = ++tagCount;
    const tagId = generateDeterministicId('wp_tag', tag.slug);
    tagMap[tag.slug] = tagId;
    try {
      let entry;
      try {
        entry = await environment.getEntry(tagId);
        console.log(`[${current}/${tagArray.length}] Tag already exists: ${tag.name} (${tagId})`);
      } catch (err) {
        console.log(`[${current}/${tagArray.length}] Creating Tag: ${tag.name} (${tagId})`);
        entry = await environment.createEntryWithId('tag', tagId, {
          fields: {
            name: { [defaultLocale]: tag.name },
            slug: { [defaultLocale]: tag.slug }
          }
        });
      }
      if (!entry.isPublished()) {
        await entry.publish();
        await sleep(350);
      }
    } catch (err) {
      console.error(`Failed to process tag ${tag.name}:`, err.message);
    }
  });

  // 3. Build Attachment Map (to resolve Featured Images)
  for (const item of items) {
    if (item['wp:post_type'] === 'attachment') {
      const postId = String(item['wp:post_id']);
      const attachmentUrl = item['wp:attachment_url'] || '';
      if (postId && attachmentUrl) {
        const match = attachmentUrl.match(/wp-content\/uploads\/(.+)$/);
        if (match) {
          const relativePath = decodeURIComponent(match[1]).replace(/\\/g, '/');
          const hash = crypto.createHash('md5').update(relativePath).digest('hex');
          attachmentIdToAssetId[postId] = `wp_media_${hash}`;
        }
      }
    }
  }

  // 4. Process Blog Posts
  console.log('\n--- Processing Blog Posts ---');
  const posts = items.filter(item => item['wp:post_type'] === 'post');
  console.log(`Found ${posts.length} posts to upload.`);

  let postCount = 0;
  await asyncPool(2, posts, async (post) => {
    const current = ++postCount;
    const wpId = String(post['wp:post_id']);
    const entryId = `wp_post_${wpId}`;
    const title = typeof post.title === 'string' ? post.title.trim() : `Post #${wpId}`;
    const slug = post['wp:post_name'] || `post-${wpId}`;
    const content = post['content:encoded'] || '';
    const richTextContent = convertHtmlToRichText(content, attachmentIdToAssetId);
    const excerpt = post['excerpt:encoded'] || '';
    const status = post['wp:status'] || 'draft';
    
    // Parse publish date
    let publishDate = null;
    const rawDate = post['wp:post_date_gmt'] || post['pubDate'];
    if (rawDate && rawDate !== '0000-00-00 00:00:00') {
      publishDate = new Date(rawDate).toISOString();
    }

    // Resolve Categories & Tags references
    const categoriesAttached = [];
    const tagsAttached = [];
    const itemCategories = Array.isArray(post.category) ? post.category : (post.category ? [post.category] : []);
    
    for (const catObj of itemCategories) {
      if (catObj && catObj['@_domain'] === 'category') {
        const catSlug = catObj['@_nicename'];
        const resolvedId = categoryMap[catSlug];
        if (resolvedId) {
          categoriesAttached.push({
            sys: { type: 'Link', linkType: 'Entry', id: resolvedId }
          });
        }
      } else if (catObj && catObj['@_domain'] === 'post_tag') {
        const tagSlug = catObj['@_nicename'];
        const resolvedId = tagMap[tagSlug];
        if (resolvedId) {
          tagsAttached.push({
            sys: { type: 'Link', linkType: 'Entry', id: resolvedId }
          });
        }
      }
    }

    // Resolve Featured Image (Thumbnail) reference
    let featuredImageRef = null;
    const postmetaList = post['wp:postmeta']
      ? (Array.isArray(post['wp:postmeta']) ? post['wp:postmeta'] : [post['wp:postmeta']])
      : [];
    for (const meta of postmetaList) {
      if (meta['wp:meta_key'] === '_thumbnail_id') {
        const thumbnailWpId = String(meta['wp:meta_value']).trim();
        const resolvedAssetId = attachmentIdToAssetId[thumbnailWpId];
        if (resolvedAssetId) {
          featuredImageRef = {
            sys: { type: 'Link', linkType: 'Asset', id: resolvedAssetId }
          };
        }
      }
    }

    try {
      let entry;
      try {
        entry = await environment.getEntry(entryId);
        console.log(`[${current}/${posts.length}] Blog Post already exists: "${title}" (${entryId})`);
        
        // Update fields
        entry.fields = {
          title: { [defaultLocale]: title },
          slug: { [defaultLocale]: slug },
          content: { [defaultLocale]: richTextContent },
          excerpt: { [defaultLocale]: excerpt },
          publishDate: publishDate ? { [defaultLocale]: publishDate } : undefined,
          categories: categoriesAttached.length > 0 ? { [defaultLocale]: categoriesAttached } : undefined,
          tags: tagsAttached.length > 0 ? { [defaultLocale]: tagsAttached } : undefined,
          featuredImage: featuredImageRef ? { [defaultLocale]: featuredImageRef } : undefined,
          status: { [defaultLocale]: status },
          wordpressId: { [defaultLocale]: parseInt(wpId, 10) }
        };
        entry = await entry.update();
        await sleep(350);
      } catch (err) {
        console.log(`[${current}/${posts.length}] Creating Blog Post: "${title}" (${entryId})`);
        entry = await environment.createEntryWithId('blogPost', entryId, {
          fields: {
            title: { [defaultLocale]: title },
            slug: { [defaultLocale]: slug },
            content: { [defaultLocale]: richTextContent },
            excerpt: { [defaultLocale]: excerpt },
            publishDate: publishDate ? { [defaultLocale]: publishDate } : undefined,
            categories: categoriesAttached.length > 0 ? { [defaultLocale]: categoriesAttached } : undefined,
            tags: tagsAttached.length > 0 ? { [defaultLocale]: tagsAttached } : undefined,
            featuredImage: featuredImageRef ? { [defaultLocale]: featuredImageRef } : undefined,
            status: { [defaultLocale]: status },
            wordpressId: { [defaultLocale]: parseInt(wpId, 10) }
          }
        });
        await sleep(350);
      }

      // Publish if post status is 'publish' in WordPress WXR
      if (status === 'publish') {
        console.log(`[${current}/${posts.length}] Publishing Blog Post: "${title}"`);
        await entry.publish();
        await sleep(350);
      }
    } catch (err) {
      console.error(`Failed to process blog post "${title}":`, err.message);
    }
  });

  console.log('\nContent upload completed successfully!');
}

uploadContent().catch((err) => {
  console.error('An error occurred during content upload:', err);
  process.exit(1);
});
