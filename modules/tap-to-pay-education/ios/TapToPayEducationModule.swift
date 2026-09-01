import ExpoModulesCore
import ProximityReader
import UIKit

/**
 * Apple's merchant education for Tap to Pay on iPhone.
 *
 * Apple review requirement 4.1 makes `ProximityReaderDiscovery` mandatory on
 * iOS 18 and later, and satisfying it also clears 4.4, 4.6, 4.7 and 4.8 —
 * because Apple authors and localizes the content itself, including the PIN
 * entry and accessibility material that Australia requires under 4.7. Writing
 * our own education screens would mean sourcing every one of those from the
 * Marketing Toolkit and keeping them current; this hands that to Apple.
 *
 * Square's Mobile Payments SDK does not surface ProximityReaderDiscovery, and
 * neither does mobile-payments-sdk-react-native, so the framework is called
 * directly. That is fine: education is pure UI and touches no payment state.
 */
public class TapToPayEducationModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TapToPayEducation")

    /**
     * Whether Apple can show its education content on this device. False on
     * iOS 17 and earlier — the API simply does not exist there, so callers
     * must keep a fallback path rather than assuming this succeeds.
     */
    Function("isAvailable") { () -> Bool in
      if #available(iOS 18.0, *) { return true }
      return false
    }

    /**
     * Present Apple's "How to Tap" education. Resolves once the merchant
     * dismisses it; rejects with a stable code the JS layer can branch on.
     *
     * Requirement 4.2 wants this shown right after the merchant accepts the
     * Tap to Pay Terms and Conditions, and 4.3 wants it reachable again later
     * from Settings or Help — same call, two entry points.
     */
    AsyncFunction("presentHowToTap") { (promise: Promise) in
      guard #available(iOS 18.0, *) else {
        promise.reject(
          "ERR_TTP_EDUCATION_UNSUPPORTED",
          "Apple's Tap to Pay education needs iOS 18 or later."
        )
        return
      }

      Task { @MainActor in
        guard let viewController = Self.topViewController() else {
          promise.reject(
            "ERR_TTP_EDUCATION_NO_VIEW",
            "No view controller was available to present Tap to Pay education from."
          )
          return
        }

        do {
          let discovery = ProximityReaderDiscovery()
          let content = try await discovery.content(for: .payment(.howToTap))
          try await discovery.presentContent(content, from: viewController)
          promise.resolve(true)
        } catch let error as ProximityReaderDiscovery.ContentError {
          promise.reject(Self.code(for: error), Self.message(for: error))
        } catch {
          promise.reject("ERR_TTP_EDUCATION_FAILED", error.localizedDescription)
        }
      }
    }
  }

  /**
   * Apple's content errors are worth distinguishing in JS: `networkUnavailable`
   * and `systemBusy` are worth a retry, the rest are not.
   */
  @available(iOS 18.0, *)
  private static func code(for error: ProximityReaderDiscovery.ContentError) -> String {
    switch error {
    case .contentNotFound: return "ERR_TTP_EDUCATION_NOT_FOUND"
    case .contentDisplayFailed: return "ERR_TTP_EDUCATION_DISPLAY_FAILED"
    case .notSupported: return "ERR_TTP_EDUCATION_UNSUPPORTED"
    case .networkUnavailable: return "ERR_TTP_EDUCATION_OFFLINE"
    case .systemBusy: return "ERR_TTP_EDUCATION_BUSY"
    case .unknown: return "ERR_TTP_EDUCATION_FAILED"
    @unknown default: return "ERR_TTP_EDUCATION_FAILED"
    }
  }

  @available(iOS 18.0, *)
  private static func message(for error: ProximityReaderDiscovery.ContentError) -> String {
    switch error {
    case .networkUnavailable:
      return "Connect to the internet to see how Tap to Pay works."
    case .systemBusy:
      return "iPhone is busy. Try showing this again in a moment."
    case .notSupported:
      return "This iPhone can't show Tap to Pay education."
    default:
      return "Couldn't open Tap to Pay education. Try again."
    }
  }

  /**
   * The topmost presented controller on the foreground window. Presenting from
   * the root while a bottom sheet is open throws, and the education is opened
   * from exactly that position — right after the merchant accepts the T&Cs
   * from inside the payment sheet.
   */
  @MainActor
  private static func topViewController() -> UIViewController? {
    let scene = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .first { $0.activationState == .foregroundActive }
      ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first

    guard
      let root = scene?.windows.first(where: { $0.isKeyWindow })?.rootViewController
        ?? scene?.windows.first?.rootViewController
    else { return nil }

    var top = root
    while let presented = top.presentedViewController, !presented.isBeingDismissed {
      top = presented
    }
    return top
  }
}
