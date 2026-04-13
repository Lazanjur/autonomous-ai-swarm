from app.services.admin_enterprise import AdminEnterpriseService


def test_normalize_policy_sanitizes_invalid_values():
    service = AdminEnterpriseService()

    policy = service.normalize_policy(
        {
            "enterprise_policy": {
                "sso": {
                    "preferred_provider": "unknown",
                    "allowed_providers": ["google", "invalid", "saml"],
                    "domain_allowlist": ["Example.com", "", " Team.Example "],
                },
                "rbac": {
                    "default_role": "owner",
                    "invite_policy": "everyone",
                },
                "quotas": {
                    "projects": -4,
                    "monthly_cost_cap_usd": -12,
                    "monthly_token_cap": "bad-value",
                    "billing_alert_thresholds": [0.8, 3, "0.5", 0.8],
                },
            }
        }
    )

    assert policy["sso"]["preferred_provider"] is None
    assert policy["sso"]["allowed_providers"] == ["google", "saml"]
    assert policy["sso"]["domain_allowlist"] == ["example.com", "team.example"]
    assert policy["rbac"]["default_role"] == "member"
    assert policy["rbac"]["invite_policy"] == "admin_only"
    assert policy["quotas"]["projects"] == 0
    assert policy["quotas"]["monthly_cost_cap_usd"] == 0.0
    assert policy["quotas"]["monthly_token_cap"] == 20_000_000
    assert policy["quotas"]["billing_alert_thresholds"] == [0.5, 0.8]


def test_normalize_policy_preserves_valid_enterprise_settings():
    service = AdminEnterpriseService()

    policy = service.normalize_policy(
        {
            "enterprise_policy": {
                "sso": {
                    "enforced": True,
                    "password_login_allowed": False,
                    "preferred_provider": "oidc",
                    "allowed_providers": ["oidc"],
                    "domain_allowlist": ["corp.example"],
                },
                "rbac": {
                    "default_role": "viewer",
                    "invite_policy": "owner_only",
                },
                "quotas": {
                    "projects": 12,
                    "threads": 80,
                    "documents": 140,
                    "artifacts": 220,
                    "automations": 15,
                    "monthly_cost_cap_usd": 320.5,
                    "monthly_token_cap": 123456,
                    "soft_enforcement": False,
                    "billing_alert_thresholds": [0.25, 0.5, 0.9],
                },
            }
        }
    )

    assert policy["sso"]["enforced"] is True
    assert policy["sso"]["password_login_allowed"] is False
    assert policy["sso"]["preferred_provider"] == "oidc"
    assert policy["sso"]["allowed_providers"] == ["oidc"]
    assert policy["rbac"]["default_role"] == "viewer"
    assert policy["rbac"]["invite_policy"] == "owner_only"
    assert policy["quotas"]["projects"] == 12
    assert policy["quotas"]["monthly_cost_cap_usd"] == 320.5
    assert policy["quotas"]["monthly_token_cap"] == 123456
    assert policy["quotas"]["soft_enforcement"] is False
    assert policy["quotas"]["billing_alert_thresholds"] == [0.25, 0.5, 0.9]
