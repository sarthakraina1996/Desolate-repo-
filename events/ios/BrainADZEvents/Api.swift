// HTTP client for the versioned API. The session token is sent as a bearer token.
import Foundation

// status 0 means the request never reached the server (no connection).
struct ApiError: Error, LocalizedError {
    let status: Int
    let message: String
    var code: String?
    var offline: Bool { status == 0 }
    var errorDescription: String? { message }
}

enum Api {
    static var baseUrl = ""
    static var token: String?
    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }()

    @discardableResult
    static func raw(_ method: String, _ path: String, _ body: [String: Any?]? = nil) async throws -> Data {
        guard let url = URL(string: "\(baseUrl)/api/v1\(path)") else {
            throw ApiError(status: 0, message: "The server address is not valid.", code: "offline")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("ios", forHTTPHeaderField: "X-Client")
        if let token = token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body = body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body.mapValues { $0 ?? NSNull() })
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw ApiError(status: 0, message: "No connection. Check the network and try again.", code: "offline")
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let err = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw ApiError(status: status, message: err?["error"] as? String ?? "Something went wrong (\(status))", code: err?["code"] as? String)
        }
        return data
    }

    static func decode<T: Decodable>(_ data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw ApiError(status: 500, message: "The server sent something this app version cannot read. Update the app.")
        }
    }
    static func get<T: Decodable>(_ path: String) async throws -> T { try decode(try await raw("GET", path)) }
    static func post<T: Decodable>(_ path: String, _ body: [String: Any?] = [:]) async throws -> T { try decode(try await raw("POST", path, body)) }
}
