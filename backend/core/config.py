from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "sqlite+aiosqlite:////data/db/ebaylister.db"
    PHOTOS_DIR: str = "/data/photos"
    OLLAMA_HOST: str = "http://ollama:11434"
    OLLAMA_MODEL: str = "qwen2.5vl:7b"
    EBAY_APP_ID: str = ""
    EBAY_CLIENT_SECRET: str = ""
    SERVER_BASE_URL: str = "http://localhost:8000"

    SHIP_DOMESTIC_SERVICE: str = "CanadaPostExpeditedParcel"
    SHIP_DOMESTIC_PRICE: float = 16.00
    SHIP_USA_SERVICE: str = "CanadaPostTrackedPacketUSA"
    SHIP_USA_PRICE: float = 17.00
    SHIP_INTL_SERVICE: str = "CanadaPostTrackedPacketIntl"
    SHIP_INTL_PRICE: float = 35.00

settings = Settings()
