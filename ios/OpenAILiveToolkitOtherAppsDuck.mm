#import "OpenAILiveToolkitOtherAppsDuck.h"

namespace openailivetoolkit {

OtherAppsDuck::OtherAppsDuck(System system) : system(std::move(system)) {}

void OtherAppsDuck::setWanted(bool duck) {
  if (duck != wanted) {
    retries = 0;
  }
  wanted = duck;
  update();
}

void OtherAppsDuck::setResumable(bool resumable) {
  this->resumable = resumable;
  update();
}

void OtherAppsDuck::update() {
  bool duck = wanted && !system.isVoiceProcessingRoute();
  if (duck == ducked) {
    return;
  }
  // Lowering waits for something the app plays again: an app that starts while others are lowered
  // would stay lowered after, since raising them would pause it. Checked again on setResumable.
  if (duck && !resumable) {
    return;
  }
  // The change would pause that app, and the app doesn't play it again.
  if (!resumable && system.otherAppPlays()) {
    if (!waitLogged) {
      system.log("Another app plays, raising other apps once it stops");
      waitLogged = true;
    }
    checkLater();
    return;
  }
  waitLogged = false;
  if (!system.setDuckOthers(duck)) {
    // From the background iOS can refuse it, and nothing may come along to update.
    if (!checkWaiting && retries < MAX_RETRIES) {
      retries++;
      checkLater();
    }
    return;
  }
  ducked = duck;
  retries = 0;
  system.changed(duck);
}

void OtherAppsDuck::checkLater() {
  if (checkWaiting) {
    return;
  }
  checkWaiting = true;
  system.later(RETRY_INTERVAL, [this] {
    checkWaiting = false;
    update();
  });
}

} // namespace openailivetoolkit
