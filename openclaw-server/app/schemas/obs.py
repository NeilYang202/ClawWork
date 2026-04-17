from pydantic import BaseModel


class UploadFileIn(BaseModel):
    mimeType: str
    fileName: str
    content: str


class ObsUploadIn(BaseModel):
    gatewayId: str
    taskId: str | None = None
    sessionKey: str
    files: list[UploadFileIn]


class UploadedFileRef(BaseModel):
    fileName: str
    objectKey: str | None = None
    url: str | None = None
    openclawPath: str


class ObsUploadOut(BaseModel):
    files: list[UploadedFileRef]


class ObsUploadRecordOut(BaseModel):
    id: int
    username: str
    gatewayId: str
    sessionKey: str
    taskId: str | None = None
    fileName: str
    mimeType: str | None = None
    byteSize: int
    objectKey: str
    url: str | None = None
    openclawPath: str
    createdAt: str


class ObsFileEventOut(BaseModel):
    eventId: str
    taskId: str | None = None
    sessionKey: str
    gatewayId: str
    fileName: str
    mimeType: str | None = None
    byteSize: int
    objectKey: str
    url: str
    createdAt: str


class ObsFileEventListOut(BaseModel):
    cursor: str
    items: list[ObsFileEventOut]
