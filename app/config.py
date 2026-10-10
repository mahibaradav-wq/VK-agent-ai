from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = Field(default="Dom po polochkam MVP", alias="APP_NAME")
    debug: bool = Field(default=True, alias="DEBUG")
    mock_mode: bool = Field(default=True, alias="MOCK_MODE")
    database_url: str = Field(default="sqlite:///./data/app.db", alias="DATABASE_URL")

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()

