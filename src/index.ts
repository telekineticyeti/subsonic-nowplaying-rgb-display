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
    const lastFmResponse = await fetch(config.lastFmNowPlayingUrl);
    const nowPlayingJson = (await lastFmResponse.json()) as LastFm.NowPlaying;

    const subsonicLatestTracks = await Subsonic.getNowPlaying();

    // API response contained an error
    if (nowPlayingJson.error) {
      log(`Error [${nowPlayingJson.error}]: ${nowPlayingJson.message}`);
      return;
    }

    // Identify the now playing track from LastFm
    const lastFmNowPlaying = nowPlayingJson.recenttracks.track[0];

    // Identify the now playing track from Subsonic, using the LastFM track as reference.
    const subsonicNowPlaying = subsonicLatestTracks.find(
      track => track.title === lastFmNowPlaying.name,
    );

    if (
      !lastFmNowPlaying.hasOwnProperty('@attr') ||
      lastFmNowPlaying['@attr']?.nowplaying === 'false' ||
      !subsonicLatestTracks.length
    ) {
      if (!sleep) {
        log('[Stopped] No currently playing tracks - Sleeping');
        // Clear the display
        ftImage.clear();
        FTC.render(ftImage);
      }

      sleep = true;

      return;
    } else if (lastFmNowPlaying.name === mostRecentTrack) {
      // Currently playing track has not changed.
      // Re-broadcast the image to the FT-server.
      FTC.render(ftImage);
      return;
    }

    sleep = false;

    let image: Buffer;
    let usedSubsonicAlbumart = false;

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

    mostRecentTrack = lastFmNowPlaying.name;

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
