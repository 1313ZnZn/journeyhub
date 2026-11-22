from urllib.parse import urlparse

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="JH_", env_file=".env", extra="ignore", hide_input_in_errors=True
    )

    service_token: SecretStr
    model_api_key: SecretStr
    model: str = "deepseek-flash"
    model_base_url: str = "https://api.deepseek.com"
    deepseek_disable_thinking: bool = True
    request_timeout_seconds: float = Field(default=35, gt=0, le=35)
    max_concurrency: int = Field(default=8, ge=1, le=64)

    @model_validator(mode="after")
    def valid_settings(self):
        if len(self.service_token.get_secret_value()) < 32:
            raise ValueError("JH_SERVICE_TOKEN must contain at least 32 characters")
        if not self.model_api_key.get_secret_value().strip():
            raise ValueError("JH_MODEL_API_KEY is required")
        url = urlparse(self.model_base_url)
        if url.scheme != "https" or not url.hostname or url.username or url.password:
            raise ValueError("JH_MODEL_BASE_URL must be an HTTPS URL without credentials")
        if url.query or url.fragment:
            raise ValueError("JH_MODEL_BASE_URL must not contain a query or fragment")
        return self
