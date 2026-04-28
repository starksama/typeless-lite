#import <AVFoundation/AVFoundation.h>
#import <dispatch/dispatch.h>

int keylesss_microphone_authorization_status(void) {
  SEL selector = @selector(authorizationStatusForMediaType:);
  if ([AVCaptureDevice respondsToSelector:selector]) {
    AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
    return (int)status;
  }

  return 3;
}

bool keylesss_request_microphone_access(void) {
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
