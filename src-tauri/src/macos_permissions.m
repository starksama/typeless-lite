#import <AppKit/AppKit.h>
#import <AVFoundation/AVFoundation.h>
#import <ApplicationServices/ApplicationServices.h>
#import <dispatch/dispatch.h>

bool verba_accessibility_is_trusted(bool prompt) {
  if (prompt) {
    NSDictionary *options = @{
      (__bridge id)kAXTrustedCheckOptionPrompt: @YES
    };
    return AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
  }

  return AXIsProcessTrusted();
}

int verba_microphone_authorization_status(void) {
  SEL selector = @selector(authorizationStatusForMediaType:);
  if ([AVCaptureDevice respondsToSelector:selector]) {
    AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
    return (int)status;
  }

  return 3;
}

bool verba_request_microphone_access(void) {
  SEL selector = @selector(requestAccessForMediaType:completionHandler:);
  if ([AVCaptureDevice respondsToSelector:selector]) {
    __block BOOL granted = NO;
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);

    [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio completionHandler:^(BOOL didGrant) {
      granted = didGrant;
      dispatch_semaphore_signal(semaphore);
    }];

    dispatch_semaphore_wait(semaphore, DISPATCH_TIME_FOREVER);
    return granted;
  }

  return true;
}

static void verba_prepare_overlay_window(NSWindow *window) {
  if (!window) {
    return;
  }

  window.opaque = NO;
  window.backgroundColor = NSColor.clearColor;
  window.hasShadow = NO;
  window.ignoresMouseEvents = YES;
  window.hidesOnDeactivate = NO;
  window.contentView.wantsLayer = YES;
  window.contentView.layer.backgroundColor = NSColor.clearColor.CGColor;
  window.level = NSStatusWindowLevel;
  window.collectionBehavior =
    NSWindowCollectionBehaviorCanJoinAllSpaces |
    NSWindowCollectionBehaviorStationary |
    NSWindowCollectionBehaviorIgnoresCycle;
}

void verba_configure_overlay_window(void *window_ptr) {
  verba_prepare_overlay_window((__bridge NSWindow *)window_ptr);
}

void verba_show_overlay_window_without_activation(void *window_ptr) {
  NSWindow *window = (__bridge NSWindow *)window_ptr;
  verba_prepare_overlay_window(window);
  [window orderFrontRegardless];
}

void verba_hide_overlay_window(void *window_ptr) {
  NSWindow *window = (__bridge NSWindow *)window_ptr;
  [window orderOut:nil];
}
