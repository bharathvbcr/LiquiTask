//! Agent budget guards and model routing (spawn-time policy).

pub const DEFAULT_HAIKU: &str = "claude-haiku-4-5";
pub const DEFAULT_SONNET: &str = "claude-sonnet-4-5";
pub const DEFAULT_OPUS: &str = "claude-opus-4-5";

pub const ESTIMATE_HAIKU_MAX_MIN: u32 = 30;
pub const ESTIMATE_SONNET_MAX_MIN: u32 = 120;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum ModelTier {
    Haiku = 0,
    Sonnet = 1,
    Opus = 2,
}

impl ModelTier {
    fn as_model_id(self) -> &'static str {
        match self {
            ModelTier::Haiku => DEFAULT_HAIKU,
            ModelTier::Sonnet => DEFAULT_SONNET,
            ModelTier::Opus => DEFAULT_OPUS,
        }
    }
}

fn priority_tier(priority: &str) -> ModelTier {
    match priority.trim().to_lowercase().as_str() {
        "low" => ModelTier::Haiku,
        "high" => ModelTier::Opus,
        _ => ModelTier::Sonnet,
    }
}

fn estimate_tier(minutes: u32) -> ModelTier {
    if minutes <= ESTIMATE_HAIKU_MAX_MIN {
        ModelTier::Haiku
    } else if minutes <= ESTIMATE_SONNET_MAX_MIN {
        ModelTier::Sonnet
    } else {
        ModelTier::Opus
    }
}

/// Pick the higher-capability tier when priority and estimate disagree.
fn max_tier(a: ModelTier, b: ModelTier) -> ModelTier {
    if a >= b { a } else { b }
}

/// Resolve the Claude model id for a spawn.
///
/// * `fixed` — always use `profile_model` when set.
/// * `auto` — route by task priority and time estimate (take the higher tier).
pub fn resolve_model(
    routing: &str,
    profile_model: Option<&str>,
    priority: Option<&str>,
    time_estimate_min: Option<u32>,
) -> Option<String> {
    if routing != "auto" {
        return profile_model
            .filter(|m| !m.trim().is_empty())
            .map(str::to_string);
    }

    let p_tier = priority
        .map(priority_tier)
        .unwrap_or(ModelTier::Sonnet);
    let e_tier = time_estimate_min
        .map(estimate_tier)
        .unwrap_or(ModelTier::Sonnet);
    Some(max_tier(p_tier, e_tier).as_model_id().to_string())
}

/// Enforce per-agent daily budget before starting a run.
///
/// `daily_cost_cap_usd` / `max_runs_per_day` of `None` or `0` mean unlimited.
pub fn check_budget(
    daily_cost_cap_usd: Option<f64>,
    max_runs_per_day: Option<u32>,
    today_spend_usd: f64,
    today_run_count: u32,
) -> Result<(), String> {
    if let Some(cap) = daily_cost_cap_usd {
        if cap > 0.0 && today_spend_usd >= cap {
            return Err(format!(
                "Daily cost cap ${cap:.2} exceeded (${today_spend_usd:.2} spent today)"
            ));
        }
    }
    if let Some(max) = max_runs_per_day {
        if max > 0 && today_run_count >= max {
            return Err(format!(
                "Max runs per day ({max}) reached ({today_run_count} started today)"
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_routing_uses_profile_model() {
        assert_eq!(
            resolve_model("fixed", Some("claude-custom"), Some("high"), Some(300)),
            Some("claude-custom".to_string())
        );
    }

    #[test]
    fn fixed_routing_without_profile_is_none() {
        assert_eq!(resolve_model("fixed", None, Some("high"), Some(300)), None);
    }

    #[test]
    fn auto_routes_low_priority_to_haiku() {
        assert_eq!(
            resolve_model("auto", None, Some("low"), Some(0)),
            Some(DEFAULT_HAIKU.to_string())
        );
    }

    #[test]
    fn auto_routes_high_priority_to_opus() {
        assert_eq!(
            resolve_model("auto", None, Some("high"), Some(0)),
            Some(DEFAULT_OPUS.to_string())
        );
    }

    #[test]
    fn auto_routes_large_estimate_to_opus() {
        assert_eq!(
            resolve_model("auto", None, Some("medium"), Some(180)),
            Some(DEFAULT_OPUS.to_string())
        );
    }

    #[test]
    fn auto_takes_higher_tier_when_priority_and_estimate_differ() {
        assert_eq!(
            resolve_model("auto", None, Some("low"), Some(240)),
            Some(DEFAULT_OPUS.to_string())
        );
    }

    #[test]
    fn budget_allows_under_cap() {
        assert!(check_budget(Some(10.0), Some(5), 9.99, 4).is_ok());
    }

    #[test]
    fn budget_blocks_cost_cap() {
        let err = check_budget(Some(5.0), None, 5.0, 0).unwrap_err();
        assert!(err.contains("Daily cost cap"));
    }

    #[test]
    fn budget_blocks_max_runs() {
        let err = check_budget(None, Some(3), 0.0, 3).unwrap_err();
        assert!(err.contains("Max runs per day"));
    }

    #[test]
    fn zero_caps_are_unlimited() {
        assert!(check_budget(Some(0.0), Some(0), 999.0, 999).is_ok());
    }
}
