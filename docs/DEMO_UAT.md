# Demo-Mode UAT: Installer Release Acceptance

This is the walkthrough Chas runs by hand before signing off on an installer
release. It checks the actual install experience end to end, in demo mode. It is
not a test of the demo fakes themselves -- it is a test of whether the wizard
looks right, reads right, and behaves right when a real person clicks through it.

## How to run

  npm start

That launches demo mode (no real git/pip/docker/ollama/tailscale are touched).
Give yourself ~20 minutes. Click like a first-time user, not like someone who
wrote the code. Read every screen out loud once. If a screen makes you pause and
wonder what to do, that is a finding even if nothing is broken.

Mark each scenario PASS, FAIL, or FLAG (see the rubric at the bottom). Write the
build/version you tested and the date at the top of your run.

  Build/version: ______________     Date: ____________     Runner: Chas

--------------------------------------------------------------------------------

## 1. App launch and first paint

Screen: (window open -> Welcome)

Actions:
  - Run `npm start`. Watch the window appear.
Expected:
  - Window opens within a few seconds, sized sensibly, not tiny or off-screen.
  - First screen paints fully. No white flash that lingers, no half-drawn layout,
    no visible "jump" as styles load.
  - Window title / taskbar entry reads as Ember, not "Electron".

  [ ] PASS   [ ] FAIL   [ ] FLAG   Notes: ______________________________________

--------------------------------------------------------------------------------

## 2. Welcome screen

Screen: Welcome

Actions:
  - Read the intro copy. Click the primary button to continue.
Expected:
  - Copy explains what this installer will do in plain language.
  - Exactly one obvious way forward. The primary button is clearly the primary.
  - Advancing goes to Prerequisites.

  [ ] PASS   [ ] FAIL   [ ] FLAG   Notes: ______________________________________

--------------------------------------------------------------------------------

## 3. Prerequisites screen

Screen: Prerequisites

Actions:
  - Let the detection run. Observe each prerequisite row (Git, Python, Node,
    Ollama, Docker).
  - Click "Install All Missing" if it is offered.
  - Click "Re-check".
  - Click "Next".
Expected:
  - Each row shows a clear state: found (with version) or missing.
  - Progress while "installing" is legible, not a frozen spinner.
  - "Next" is disabled until prerequisites are satisfied, then enables.
  - Nothing claims success while a row still looks unresolved.

  [ ] PASS   [ ] FAIL   [ ] FLAG   Notes: ______________________________________

--------------------------------------------------------------------------------

## 4. Install location -- fresh install

Screen: Install location

Actions:
  - Read the default path. Click "Browse..." and pick a folder, then confirm.
  - Click "Install Here".
Expected:
  - A sensible default path is prefilled.
  - The picker opens, and the chosen path shows back in the field.
  - "Install Here" advances to Vault setup.

  [ ] PASS   [ ] FAIL   [ ] FLAG   Notes: ______________________________________

--------------------------------------------------------------------------------

## 5. Install location -- existing install detected (reinstall path)

Screen: Install location

Actions:
  - Point the location at a folder the wizard treats as an existing Ember
    install (demo will surface the detection panel).
  - Read the choices: "Use this installation", "Update existing",
    "Fresh install", "Choose different location".
  - Try "Update existing", then back out and try "Fresh install".
Expected:
  - The wizard clearly warns that something is already there.
  - The difference between "Update existing" and "Fresh install" is
    understandable -- a user can tell which one keeps their data.
  - "Choose different location" gets you back to picking cleanly.

  [ ] PASS   [ ] FAIL   [ ] FLAG   Notes: ______________________________________

--------------------------------------------------------------------------------

## 6. Vault location -- including cloud-folder warning

Screen: Vault setup

Actions:
  - Read the explanation of what the vault is.
  - Pick a normal local folder via "Browse...".
  - Now enter or pick a path containing "OneDrive" (or "Dropbox").
Expected:
  - Copy makes clear this is the private data location.
  - A cloud-sync path (OneDrive/Dropbox) triggers a visible warning.
  - A plain local path shows no warning.
  - Vault names or contents never appear anywhere on screen (this is demo --
    there should be nothing real, and nothing real should ever leak here).

  [ ] PASS   [ ] FAIL   [ ] FLAG   Notes: ______________________________________

--------------------------------------------------------------------------------

## 7. Model selection

Screen: Model selection

Actions:
  - Read the model cards. Note the recommended default is marked.
  - Check disk size and RAM requirement on each card.
  - Select a non-default model, then the default. Click "Next".
Expected:
  - Cards are readable: name, what it is good for, disk size, RAM need.
  - One card is clearly the recommended default.
  - Selecting a card gives clear visual feedback on which is chosen.
  - Hardware-based recommendation copy reads sensibly (not "undefined GB").

  [ ] PASS   [ ] FAIL   [ ] FLAG   Notes: ______________________________________

--------------------------------------------------------------------------------

## 8. Vision model

Screen: Vision model

Actions:
  - Leave vision off and read the screen. Then toggle it on.
  - With it on, confirm a vision model card appears and is selectable.
  - Toggle it back off.
Expected:
  - Off by default, clearly optional.
  - Toggling on reveals the vision model choice; toggling off hides it.
  - No leftover selection state when toggled off.

  [ ] PASS   [ ] FAIL   [ ] FLAG   Notes: ______________________________________

--------------------------------------------------------------------------------

## 9. Host configuration -- local and Tailscale

Screen: Host configuration

Actions:
  - Read the local-only option and the Tailscale (multi-device) option.
  - Choose local-only, then switch to Tailscale.
  - With Tailscale selected, try "Set up HTTPS".
  - Click "Review & Install".
Expected:
  - The two options are clearly distinguished (single machine vs. reachable
    from other devices).
  - Tailscale path shows status/hostname/IP sensibly in demo.
  - "Set up HTTPS" gives feedback, not a dead click.
  - "Review & Install" advances to Summary.

  [ ] PASS   [ ] FAIL   [ ] FLAG   Notes: ______________________________________

--------------------------------------------------------------------------------

## 10. Summary screen -- and Back behavior

Screen: Summary

Actions:
  - Read every line. Confirm it reflects the exact choices you made
    (location, vault, model, vision on/off, host mode).
  - Use Back to return a screen or two, change one choice, come forward again.
  - Confirm the summary updates to match the change.
Expected:
  - Summary is an accurate mirror of your selections.
  - Back does not lose your earlier entries or reset the wizard.
  - A changed choice is reflected on return, not stale.

  [ ] PASS   [ ] FAIL   [ ] FLAG   Notes: ______________________________________

--------------------------------------------------------------------------------

## 11. Install screen -- progress and logs

Screen: Install

Actions:
  - Click "Install". Watch the whole run.
Expected:
  - Each step shows progress and then a clear done state.
  - Log/progress text scrolls and stays readable; no wall of raw noise, no
    frozen bar while text still streams.
  - No step silently stalls. No step reports done while its log looks failed.
  - The screen ends in a clearly finished state and moves on (to AGPL).

  [ ] PASS   [ ] FAIL   [ ] FLAG   Notes: ______________________________________

--------------------------------------------------------------------------------

## 12. Error path -- cancelling folder pickers and dead-clicks

Screen: Install location / Vault (any picker)

Actions:
  - Open a "Browse..." picker and CANCEL it without choosing.
  - Confirm the field keeps its previous value and nothing breaks.
  - Rapidly double-click primary buttons on a couple of screens.
  - On Summary, try to proceed with anything the wizard should reject and watch
    for the inline error line.
Expected:
  - Cancelling a picker is a no-op: no crash, no blank field, no stuck button.
  - Double-clicking does not double-advance or freeze a button on its "working"
    label.
  - A rejected action surfaces a readable inline error, not a silent nothing and
    not a raw stack trace.

  [ ] PASS   [ ] FAIL   [ ] FLAG   Notes: ______________________________________

--------------------------------------------------------------------------------

## 13. AGPL acknowledgment

Screen: AGPL acknowledgment

Actions:
  - Read the license acknowledgment. Click "I understand".
Expected:
  - The obligation is stated plainly, not buried.
  - You cannot slip past it by accident; acknowledging is a deliberate click.
  - Advancing goes to the Done screen.

  [ ] PASS   [ ] FAIL   [ ] FLAG   Notes: ______________________________________

--------------------------------------------------------------------------------

## 14. Completion (Done) -- Launch Services and Open Ember

Screen: Done

Actions:
  - Watch the API health poll settle.
  - Once enabled, click "Launch Services".
  - Then click "Open Ember".
  - If the API path shows "Try Again", exercise it.
  - Note the vault storage estimate line.
Expected:
  - Buttons start disabled and enable only once the screen says things are ready.
  - "Launch Services" and "Open Ember" give clear feedback in demo.
  - "Open Ember" attempting to open the app fails gracefully in demo (nothing
    real to open) -- no crash, no confusing error.
  - Storage estimate reads as a real number, not a placeholder.

  [ ] PASS   [ ] FAIL   [ ] FLAG   Notes: ______________________________________

--------------------------------------------------------------------------------

## 15. Reinstall / uninstall awareness

Screen: Install location (reinstall) + external uninstaller

Actions:
  - Reinstall path: restart the wizard, point at the same install location, and
    confirm the existing-install detection from scenario 5 fires again and the
    "Update existing" vs "Fresh install" choice is coherent on a second pass.
  - Uninstall: note that the true uninstall is the Windows NSIS uninstaller,
    which is outside demo mode. Confirm only that the wizard does not pretend to
    uninstall anything it cannot, and that reinstalling over an existing install
    is the flow a user actually has here.
Expected:
  - Second-pass detection behaves the same as the first.
  - No false promise of an in-app uninstall in demo.
  - Reinstall-over-existing is understandable without docs.

  [ ] PASS   [ ] FAIL   [ ] FLAG   Notes: ______________________________________

--------------------------------------------------------------------------------

## 16. Poke around (5 minutes, unstructured)

Screen: anywhere

Actions:
  - Spend five real minutes just using it. Resize the window. Go backward and
    forward through screens out of the "happy" order. Toggle the developer-mode
    checkbox on the Done screen and watch the Matrix easter egg fire, then
    confirm it does not replay on a second toggle. Hover things. Read the small
    copy. Click the links.
Expected:
  - Nothing visually broken: no overlapping text, cut-off buttons, misaligned
    cards, wrong colors, broken images, or scrollbars where there should be none.
  - Nothing that "feels off": awkward wording, a button that looks primary but
    is not, a screen that takes too long, a transition that stutters.
  - The easter egg plays once and cleanly returns you to a usable screen.
Write down every small thing, even if it is not a bug. This scenario is where
polish problems get caught.

  [ ] PASS   [ ] FAIL   [ ] FLAG   Notes: ______________________________________
  ___________________________________________________________________________
  ___________________________________________________________________________

--------------------------------------------------------------------------------

## Rubric

PASS
  The screen did what a first-time user would expect. It looked finished, read
  clearly, and behaved correctly. You would be comfortable shipping it as-is.

FAIL
  Something is broken or wrong enough to block the release: a crash, a stuck
  button, a step that reports success while it looks failed, data or a path that
  is plainly wrong, a screen you cannot get past, or a raw stack trace shown to
  the user. Any FAIL blocks sign-off until fixed or explicitly waived.

FLAG (for follow-up)
  Not broken, but not right. Confusing wording, a rough transition, a layout
  that is slightly off, a default that seems questionable, a moment where you
  hesitated. The release can still ship, but the FLAG gets written up as a
  follow-up item. A pile of FLAGs on one screen is itself a FAIL signal --
  say so.

## Sign-off

  All scenarios PASS (or FLAGs accepted): ____   Signed: __________  Date: ______

  If any FAIL: do not sign. List the blocking scenario numbers here:
  ___________________________________________________________________________
