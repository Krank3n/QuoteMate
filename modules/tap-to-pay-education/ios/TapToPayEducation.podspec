Pod::Spec.new do |s|
  s.name           = 'TapToPayEducation'
  s.version        = '1.0.0'
  s.summary        = "Apple's Tap to Pay on iPhone merchant education (ProximityReaderDiscovery)"
  s.description    = 'Presents Apple-authored, Apple-localized Tap to Pay merchant education. Required by Apple review requirement 4.1 on iOS 18 and later.'
  s.author         = 'QuoteMate'
  s.homepage       = 'https://quotemateapp.au'
  s.platforms      = { :ios => '16.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.license        = { :type => 'MIT' }

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
