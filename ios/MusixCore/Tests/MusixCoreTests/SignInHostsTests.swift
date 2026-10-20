import XCTest
@testable import MusixCore

final class SignInHostsTests: XCTestCase {
    func testRecognisesGoogleAccountHostsOnly() {
        XCTAssertTrue(SignInHosts.isAccountsHost("accounts.google.com"))
        XCTAssertTrue(SignInHosts.isAccountsHost("ACCOUNTS.GOOGLE.CO.UK"))
        XCTAssertTrue(SignInHosts.isAccountsHost("accounts.youtube.com"))
        XCTAssertFalse(SignInHosts.isAccountsHost("music.youtube.com"))
        XCTAssertFalse(SignInHosts.isAccountsHost("accounts.google.com.evil.example"))
        XCTAssertFalse(SignInHosts.isAccountsHost(nil))
    }

    func testBuildsAMobileSafariAgentThatMatchesTheDevice() {
        XCTAssertEqual(
            SignInHosts.mobileSafari(systemVersion: "27.0.1", isPad: false),
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1"
        )
        XCTAssertEqual(
            SignInHosts.mobileSafari(systemVersion: "17.5", isPad: true),
            "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
        )
    }
}
