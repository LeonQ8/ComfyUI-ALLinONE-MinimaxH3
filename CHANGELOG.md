# Changelog

Newest first.

## Unreleased

Mask mode can paint or describe a region in a source video, track it with SAM 3, replace it with H3 reference inpainting, and keep the rest of the video unchanged. A Mask target now defines what SAM tracks, so typing "face" tracks the face instead of the whole painted area, and the replacement region hugs the tracked object. The H3 crop also follows the object's own shape like the droz reference template instead of a fixed widescreen canvas, so the replacement gets more pixels and cleaner edges.

 - Mask mode has a Preview tracking button that runs only the SAM 3 tracking part and shows what gets tracked as colored masks over the video, in seconds and before any H3 generation. The same overlay appears live during a real run, so you can Stop early if it caught the wrong thing.
 - The tracking preview also draws the crop rectangle H3 will generate and reads the tracking confidence in plain words. It turns green when the track and crop are good, and shows a warning with a concrete fix when the track is weak, the crop cuts the subject, or the crop box jumps around.
 - Mask mode audio is now a three-way choice: preserve the source soundtrack with lip-sync for talking heads, preserve it without lip-sync so a dancer does not appear to sing, or let H3 compose a new soundtrack.
 - In Mask mode, painting a region and describing it with text are two separate paths. Mixing manual inpainting with a text prompt does not work well, so the README recommends picking one approach per mask.

## 0.8.0 (2026-08-19)

 - New + Queue button under Generate.
 - The queue row shows a counter of how many jobs are still queued and their modes.
 - This feature is in beta. If anything goes wrong, open an issue.

## 0.7.2 (2026-08-19)

 - The Library now has bulk management: pick Select to tick several videos & images.
 - Download ZIP saves the ticked outputs into one archive.
 - Favorite and unfavorite videos straight from a Library card with the star button.
 - The Library header shows how many videos and images it holds, plus how many are selected while ticking.
 - The Outputs strip can be collapsed to give the preview more room.

## 0.7.1 (2026-08-19)

 - Extend mode now adds about the number of seconds you ask for. Extending a 5 second clip by 5 seconds gives roughly 10 seconds instead of growing to 16 or more, and re-extending the result keeps adding about the same amount each time.
 - Extend mode pins a shorter tail of the source video as context, so the join keeps more of the original quality and sound.
 - Extend matches the source video's resolution automatically, so the new part keeps the same sharpness and framing as the original instead of looking cut and lower quality.
 - New Auto stage result toggle in Extend mode. Off keeps the same source video for every run so the length stays predictable.
 - The sound at the extend join is now smoothed with a short crossfade, so the cut between the first clip and the extended part no longer clicks.

## 0.7.0 (2026-08-19)

 - Comfy Kitchen attention is now a third toggle chip under Quality. It runs alone or together with SolAttn, and never with SageAttention. Needs `pip install comfy-kitchen` and a restart.

## 0.6.4 (2026-08-19)

 - Updated the tested node packs for ComfyUI 0.33.0: KJNodes, Motion Context, Turbo and H3 Studio.
 - Removed the H3 Cache option because its pack was not updated for newer ComfyUI and caused crashes in Chain and Extend on ComfyUI 0.33, with no fix available.
 - Speed preset no longer needs the cache pack and now runs on SolAttn only.
 - Fixed Extend mode for the new Motion Context update by adding the audio feather ticks input it now requires.
 - Image mode no longer fails when a custom size goes over H3 Studio's 8.5 MP limit: the canvas is scaled down to the allowed size and the recipe chip shows a capped note.
 - Text to Image no longer reuses reference images left over from Reference Mix or Image Edit: each image sub-mode now sends only its own images to the model.
 - Image Edit and Reference Mix now keep separate image slots: a source image added in one mode no longer shows up in the other.
 - Reference Mix slots now sit in a fixed grid with @Image numbers, so adding images no longer reflows the row.
 - Compatibility docs now list ComfyUI 0.33.0 as the tested version.

## 0.6.3 (2026-08-18)

 - UI layout fixes and polish across the panel.
 - Videos and images can now fit to a chosen source frame, with a custom size option per media slot.
 - Fixed a bug where a freshly generated image could show an older one when the file name got reused.
 - Generated images now show in the History page instead of a black box.

Known issues: R2V has a bug following the reference video's motion, will be investigated and fixed in the next release.

## 0.6.2 (2026-08-18)

 - The resolution dropdown got a swap button that flips any size between landscape and portrait, and custom sizes now round to the 32-pixel grid when you leave the field.
 - Every dropdown now shows its full text on hover.
 - The Tune pills are clickable and open the matching dropdown or focus the matching field.
 - The Tune section is reorganized so related settings sit together.
 - R2V now crops the first reference image to fit the frame instead of stretching it, and a hint under the references explains how multiple images are used.

## 0.6.1 (2026-08-18)

Live Preview now plays the whole clip while it samples instead of showing one still frame, powered by KJNodes Model Preview Override. A dropdown next to the Live Preview toggle picks between three presets: Fast, Balanced and Detailed. Fast is the lightest on generation speed, Detailed looks the best. Needs ComfyUI-KJNodes and taeh3.safetensors in a models/vae_approx folder.

## 0.6.0 (2026-08-18)

- The Text Encoder list now only shows the model H3 actually uses.
- New FPS setting under Duration controls frame count and output framerate.
- Right-click a video in the Library or Gallery to send it straight into Extend mode.
- Extend results are auto-staged so you can chain extends.
- Videos in the History page now have a Send to Extend button.
- Reference image and video thumbs keep their real aspect ratio instead of being cropped square.
- The Seed field clamps to the maximum the H3 model accepts.
- A Resolution chip appears on the preview.

## 0.5.2 (2026-08-18)

Each LoRA now has an on/off switch, and the Advanced panel has an Enable all / Disable all button. Disabled LoRAs keep their row but skip loading, so you can stack up to 10 LoRAs and switch between setups without deleting them.

Known issues: Chain mode can have issues, will be looked at in future releases. Images made with Image workflows can show black in the History, will be fixed in future releases.

## 0.5.1 (2026-08-17)

Fixed a bug where the node could still use an old photo right after you added a new one. The new photo now always loads before generation starts, and if loading fails the old photo stays instead of silently breaking.

## 0.5.0 (2026-08-17)

Image Edit and Reference Mix now include a Compare slider for checking the source against the result. Image mode now shows one final still instead of the internal frame batch. Upscaling in Image workflows is currently broken and will be fixed in a later release.

## 0.4.2 (2026-08-17)

Minor fixes.

## 0.4.1 (2026-08-17)

Live Preview is new: a toggle under the video that shows the clip while it samples with the tiny TAEH3 decoder. Needs the H3 Studio pack plus taeh3.safetensors in a models/vae_approx folder. Works in every video mode, but not with the Turbo preset or Image mode.

## 0.3.0 (2026-08-16)

New Image mode built on ComfyUI-MiniMax-H3-Studio. Text to image, edit a source image, or mix up to 9 references with @Image1 style roles. Base and LightX sampling profiles plus custom steps, sampler and scheduler. Needs the H3 Studio pack and the two Qwen3.5 prompt models, download links are in the README.

Turbo now uses whatever steps you set, 6 is only the default.

## 0.2.0 (2026-08-16)

New Native quality preset that runs the H3 pipeline with no accelerators.

SolAttn, H3 Cache and SageAttention can now be switched on and off with their own chips under Quality. Mixed setups show as Custom.

## 0.1.2 (2026-08-15)

Fixed the Support button, it now links to the real Ko-fi page.

README badges and beta note.

## 0.1.1 (2026-08-15)

Prompts are now saved per mode and restored when switching tabs.

Compatibility docs updated to ComfyUI 0.32.0.

## 0.1.0 (2026-08-15)

First release with T2V, I2V, R2V, Audio Drive, Keyframes, Extend, Chain and Upscale in a single node.
