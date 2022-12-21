import {FlaschenTaschenClient} from 'flaschen-taschen-node';
import Jimp from 'jimp';
import config from './config';
import fetch from 'node-fetch';
import util from 'util';

// Create the FT client instance and prepare a new image that will be used to store the
// now playing artwork.
const FTC = new FlaschenTaschenClient(config.ft_host);
const ftImage = FTC.create({height: config.ft_width, width: config.ft_height});
let mostRecentTrack: string;
let sleep = false;

function log(msg: any) {
  if (!config.debug) return;
  if (typeof msg === 'object') {
    console.debug(util.inspect(msg, false, 5, true));
    return;
  }
  console.debug(msg);
}

async function updateNowPlaying() {
  try {
    const response = await fetch(config.lastFmNowPlayingUrl);
    const nowPlayingJson = (await response.json()) as LastFm.NowPlaying;

    // API response contained an error
    if (nowPlayingJson.error) {
      log(`Error [${nowPlayingJson.error}]: ${nowPlayingJson.message}`);
      throw new Error(`Error [${nowPlayingJson.error}]: ${nowPlayingJson.message}`);
    }

    const nowPlayingTrack = nowPlayingJson.recenttracks.track[0];

    if (
      !nowPlayingTrack.hasOwnProperty('@attr') ||
      nowPlayingTrack['@attr']?.nowplaying === 'false'
    ) {
      if (!sleep) {
        log('[Stopped] No currently playing tracks - Sleeping');
        // Clear the display
        ftImage.clear();
        FTC.render(ftImage);
      }

      sleep = true;

      return;
    } else if (nowPlayingTrack.name === mostRecentTrack) {
      // Currently playing track has not changed.
      // Re-broadcast the image to the FT-server.
      FTC.render(ftImage);
      return;
    }

    sleep = false;

    const imageUrl = nowPlayingTrack.image.find(i => i.size === 'extralarge')?.['#text']!;

    await Jimp.read(imageUrl).then(img => {
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
        `[Updated] ${nowPlayingTrack.artist['#text']} - ${nowPlayingTrack.name} [${
          nowPlayingTrack.album['#text']
        }] ${img.getWidth()}x${img.getHeight()} (${pixelCount} pixels)`,
      );
    });

    mostRecentTrack = nowPlayingTrack.name;

    // Send the image to the FT server
    FTC.render(ftImage);
  } catch (error) {
    throw new Error(error as any);
  }
}

/**
 * Set up server
 */
console.log(`LastFM now playing album art updater started!`);
setInterval(updateNowPlaying, config.poll_frequency);
