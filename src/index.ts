import {FlaschenTaschenClient} from 'flaschen-taschen-node';
import SubsonicApiWrapper from 'subsonic-api-wrapper';
import Jimp from 'jimp';
import config from './config';
import fetch from 'node-fetch';
import util from 'util';

const Subsonic = new SubsonicApiWrapper({
  server: config.subsonic_host,
  username: config.subsonic_user,
  password: config.subsonic_pass,
});

// Create the FT client instance and prepare a new image that will be used to store the
// now playing artwork.
const FTC = new FlaschenTaschenClient(config.ft_host);
const ftImage = FTC.create({height: config.ft_width, width: config.ft_height});
// A reference for the most recently played track, used for comparison in subsequent calls.
let mostRecentTrack: string;
// If isSleeping is true, no images are sent to the FT server.
let isSleeping = false;

async function updateNowPlaying() {
  try {
    // Retrieve most recent tracks from Subsonic
    const subsonicLatestTracks = await Subsonic.getNowPlaying();
    if (!subsonicLatestTracks.length) {
      sleep();
      return;
    }

    // Retrieve LastFM now playing track
    const lastFmResponse = await fetch(config.lastFmNowPlayingUrl);
    const nowPlayingJson = (await lastFmResponse.json()) as LastFm.NowPlaying;

    // API response contained an error
    if (nowPlayingJson.error) {
      log(`Error [${nowPlayingJson.error}]: ${nowPlayingJson.message}`);
      return;
    }

    // Identify the now playing track from LastFm
    const lastFmNowPlaying = nowPlayingJson.recenttracks.track[0];

    if (
      !lastFmNowPlaying.hasOwnProperty('@attr') ||
      lastFmNowPlaying['@attr']?.nowplaying === 'false'
    ) {
      sleep();
      return;
    } else if (lastFmNowPlaying.name === mostRecentTrack) {
      // Currently playing track has not changed.
      // Re-broadcast the image to the FT-server.
      FTC.render(ftImage);
      return;
    }

    isSleeping = false;

    let image: Buffer;
    let usedSubsonicAlbumart = false;

    // Identify the now playing track from Subsonic, using the LastFM track as reference.
    const subsonicNowPlaying = subsonicLatestTracks.find(
      track => track.title.toLowerCase() === lastFmNowPlaying.name.toLowerCase(),
    );

    // If the now-playing track scraped from lastFM exists in SubSonic tracks array, use the album art
    // from the match item.
    // Else, fallback to the album art from lastFM.
    if (subsonicNowPlaying) {
      image = await Subsonic.getCoverArt(
        subsonicNowPlaying.coverArt,
        config.subsonic_fetch_dimension,
      );
      usedSubsonicAlbumart = true;
    } else {
      const imageUrl = lastFmNowPlaying.image.find(i => i.size === 'extralarge')?.['#text']!;
      const imageResponse = await fetch(imageUrl);
      image = await imageResponse.buffer();
      usedSubsonicAlbumart = false;
    }

    // Read the image buffer and plot pixels to the FT image.
    await Jimp.read(image).then(img => {
      img.scaleToFit(config.ft_width, Jimp.AUTO, Jimp.RESIZE_BEZIER).contrast(0.1);

      let w = img.getWidth(),
        h = img.getHeight();

      let pixelCount = 0;

      for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
          let pixi = Jimp.intToRGBA(img.getPixelColor(x, y));
          ftImage.plot(x, y, {r: pixi.r, g: pixi.g, b: pixi.b});
          pixelCount++;
        }
      }

      log(
        `[Updated - ${usedSubsonicAlbumart ? 'Subsonic' : 'LastFM'}] ${
          lastFmNowPlaying.artist['#text']
        } - ${lastFmNowPlaying.name} [${
          lastFmNowPlaying.album['#text']
        }] ${img.getWidth()}x${img.getHeight()} (${pixelCount} pixels)`,
      );
    });

    // Set reference for the most recently played track. If this reference matches
    // on next poll, we will re-send the same image instead of building it again.
    mostRecentTrack = lastFmNowPlaying.name;

    // Send the image to the FT server
    FTC.render(ftImage);
  } catch (error) {
    throw new Error(error as any);
  }
}

function log(msg: any) {
  if (!config.debug) return;
  if (typeof msg === 'object') {
    console.debug(util.inspect(msg, false, 5, true));
    return;
  }
  console.debug(msg);
}

function sleep() {
  if (!isSleeping) {
    log('[Stopped] No currently playing tracks - Sleeping');
    // Clear the display
    ftImage.clear();
    FTC.render(ftImage);
  }
  isSleeping = true;
  return;
}

/**
 * Set up server
 */
console.log(`LastFM now playing album art updater started!`);
setInterval(updateNowPlaying, config.poll_frequency);
