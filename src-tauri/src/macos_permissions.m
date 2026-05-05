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
