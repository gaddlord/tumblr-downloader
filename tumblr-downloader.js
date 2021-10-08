/* 
Download liked images and videos from Tumblr likes.
Run this with NodeJS by executing the command `node tumblr-downloader.js`

For automated mass clean of likes use this Chrome extension:
https://chrome.google.com/webstore/detail/xkit-rewritten/ehgbadgnkmeeldglkmnplolneidgpbcm/related
*/
const path = require('path');
const fs = require('fs');
const got = require('got');
const stream = require('stream');
const { promisify } = require('util');

/* https://www.tumblr.com/docs/en/api/v2#likes--retrieve-blogs-likes */

const USERNAME = 'YOUR_TUMBLR_USERNAME';
const API_KEY = 'YOUR_TUMBLR_API_KEY';
const IMAGE_DIR = 'C:/tumblr';
const DEFAULT_BATCH_SIZE = 50;
const CREATE_DIR_FOR_EACH_BOARD = false;
const UNLIKE_DOWNLOADED_LIKES = false;

const LIKES_URL_PREFIX =
  'https://api.tumblr.com/v2/blog/' + USERNAME + '.tumblr.com/likes?api_key=' + API_KEY;
const UNLIKE_URL_PREFIX = 'https://api.tumblr.com/v2/user/unlike?api_key=' + API_KEY;

let totalLikes; // total number of Likes
let batch; // the batch number. Each batch has DEFAUT_BATCH_SIZE number of likes.
let skipped = 0; // number of skipped files already been downloaded
let downloaded = 0; // number of downloaded successfully files
let before = 0; // timemarker before which to search for Likes

async function main() {
  skipped = 0;
  totalLikes = await getLikedCount();
  if (totalLikes > 0) {
    await download();
  }
  console.log(`Skipped downloading ${skipped} files since they already exist on disk.`);
  console.log(`Downloaded ${downloaded} files.`);
}

async function getLikedCount() {
  const url = `${LIKES_URL_PREFIX}&limit=1`;
  const responseJson = await got(url).json();
  if (responseJson.meta.status === 403) {
    console.error(
      "Forbidden. Please, enable the 'Share posts you like' option in your tumblr settings from https://www.tumblr.com/settings/blog/" +
        USERNAME
    );
  } else if (responseJson.meta.status === 401) {
    console.error('Unauthorized. Please, check your username and API_KEY');
  }
  return responseJson.response.liked_count;
}

async function download() {
  let downloaded = 0;
  batch = 0;
  while (downloaded < totalLikes) {
    await getPhotos(DEFAULT_BATCH_SIZE, before);
    downloaded += DEFAULT_BATCH_SIZE;
    batch++;
  }
}

async function getPhotos(limit = 0) {
  const url = `${LIKES_URL_PREFIX}&limit=${limit}&before=${before}`;
  console.log(url);
  const responseJson = await got(url).json();
  const statusCode = responseJson.meta.status;
  if (statusCode !== 200) {
    console.error(responseJson.meta.msg);
  }
  await downloadLikes(responseJson.response.liked_posts);
  if (!responseJson.response._links.next) {
    return;
  }
  before = responseJson.response._links.next.query_params.before;
}

function getFilename(url) {
  return url.split('/').pop();
}

async function quickDownload(uri, filename) {
  // create the directory if it does not exist
  var dir = path.dirname(filename);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
  const pipeline = promisify(stream.pipeline);
  await pipeline(got.stream(uri), fs.createWriteStream(filename));
  downloaded++;
}

async function unlike(id, reblogKey) {
  if (UNLIKE_DOWNLOADED_LIKES) {
    // unlike
    const url = `${UNLIKE_URL_PREFIX}&id=${id}&reblog_key=${reblogKey}`;
    try {
      const responseJson = await got.post(url).json();
      console.log(responseJson);
    } catch (e) {
      console.log(e);
    }
  }
}

async function storeOnDisk(uri, blog, id, reblogKey) {
  if (!uri) {
    throw new Error('URI is missing.');
  }
  if (uri.includes('redirect?z=')) {
    console.log('Redirect is skipped.');
    return;
  }
  console.log(uri);
  let dir;
  if (CREATE_DIR_FOR_EACH_BOARD) {
    // create a directory with the name of the board
    dir = path.join(IMAGE_DIR, blog);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
  } else {
    dir = IMAGE_DIR;
  }
  const filename = path.join(dir, getFilename(uri));
  if (!fs.existsSync(filename)) {
    try {
      await quickDownload(uri, filename);
    } catch (e) {
      console.error(e);
    }
  } else {
    skipped++;
    console.log('Skipping download. File already exists.');
  }
  await unlike(id, reblogKey);
}

async function downloadLikes(likes) {
  for (let i = 0; i < likes.length; i++) {
    console.log(`${i + batch * DEFAULT_BATCH_SIZE} of ${totalLikes}`);
    const like = likes[i];
    switch (like.type) {
      case 'photo':
        if (like.photos) {
          const photos = like.photos;
          for (const photo of photos) {
            const uri = photo.original_size.url;
            await storeOnDisk(uri, like.blog_name, like.id, like.reblog_key);
          }
        } else {
          throw new Error('We expect a Like of type Photo to have a Photos element.');
        }
        break;
      case 'text':
        if (like.body) {
          let regex = /"url":"(?<url>.*?)"/g;
          let match = regex.exec(like.body);
          if (match) {
            const uri = match[1];
            await storeOnDisk(uri, like.blog_name, like.id, like.reblog_key);
          } else {
            regex = /<img src="(?<url>.*?)"/g;
            match = regex.exec(like.body);
            if (match) {
              const uri = match[1];
              await storeOnDisk(uri, like.blog_name, like.id, like.reblog_key);
            } else {
              throw new Error('Unrecognized format of like of type Text. Check the regex.');
            }
          }
        } else {
          throw new Error('We expect a Like of type Text to have a Body elemenent.');
        }
        break;
      case 'video':
        if (like.video_url) {
          const uri = like.video_url;
          await storeOnDisk(uri, like.blog_name, like.id, like.reblog_key);
        } else {
          console.error(
            `We expect a Like with id = ${like.id} of type Video to have Video_URL element.`
          );
        }
        break;
      case 'answer':
        // skip this type
        break;
      case 'link':
        console.log(like);
        break;
      default:
        throw new Error(`Urecognized ${like.type} type.`);
    }
  }
}

main();
