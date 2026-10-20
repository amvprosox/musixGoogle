package com.realmadhoney.musix.core.adblock

class UrlRules private constructor(
    private val rules: List<Pair<String, String>>,
) {
    val size: Int get() = rules.size

    fun matches(
        host: String,
        pathAndQuery: String,
    ): Boolean {
        val normalized = host.lowercase().trimEnd('.')
        if (normalized.isEmpty()) {
            return false
        }
        return rules.any { (ruleHost, prefix) ->
            (normalized == ruleHost || normalized.endsWith(".$ruleHost")) && pathAndQuery.startsWith(prefix)
        }
    }

    companion object {
        val EMPTY = UrlRules(emptyList())
        private val HOST = Regex("^[a-z0-9.-]{1,253}$")

        fun parse(text: String): UrlRules {
            val rules =
                text
                    .lineSequence()
                    .map { it.trim() }
                    .filter { it.isNotEmpty() }
                    .mapNotNull { line ->
                        val parts = line.split('\t')
                        if (parts.size != 2) return@mapNotNull null
                        val host = parts[0].lowercase()
                        val prefix = parts[1]
                        if (!HOST.matches(host) || !prefix.startsWith("/") || prefix.length > 200) null else host to prefix
                    }.toList()
            return UrlRules(rules)
        }
    }
}
