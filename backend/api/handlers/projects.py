from beanie import PydanticObjectId
from fastapi import APIRouter, Depends, HTTPException

from api.deps import get_current_user, require_admin
from models.endpoint import Endpoint
from models.project import Project
from models.user import User
from schemas.project import CreateProjectRequest, UpdateProjectRequest

router = APIRouter(prefix="/projects", tags=["projects"])


def serialize_project(p: Project, endpoint_count: int = 0) -> dict:
    return {
        "_id": str(p.id),
        "name": p.name,
        "color": p.color,
        "createdAt": p.created_at.isoformat(),
        "updatedAt": p.updated_at.isoformat(),
        "endpointCount": endpoint_count,
    }


@router.get("")
async def list_projects(user: User = Depends(get_current_user)):
    projects = await Project.find_all().sort("name").to_list()

    pipeline = [
        {"$match": {"projectId": {"$ne": None}}},
        {"$group": {"_id": "$projectId", "count": {"$sum": 1}}},
    ]
    counts = await Endpoint.aggregate(pipeline).to_list()
    count_map = {str(c["_id"]): c["count"] for c in counts}

    return [serialize_project(p, count_map.get(str(p.id), 0)) for p in projects]


@router.post("", status_code=201)
async def create_project(body: CreateProjectRequest, admin: User = Depends(require_admin)):
    existing = await Project.find_one(Project.name == body.name)
    if existing:
        raise HTTPException(status_code=409, detail="A project with that name already exists")

    project = Project(name=body.name, color=body.color or "#e8871e")
    await project.insert()

    return serialize_project(project)


@router.get("/{project_id}")
async def get_project(project_id: str, user: User = Depends(get_current_user)):
    project = await Project.get(PydanticObjectId(project_id))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    return serialize_project(project)


@router.put("/{project_id}")
async def update_project(project_id: str, body: UpdateProjectRequest, admin: User = Depends(require_admin)):
    project = await Project.get(PydanticObjectId(project_id))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if body.name is not None:
        project.name = body.name
    if body.color is not None:
        project.color = body.color
    await project.save()

    return serialize_project(project)


@router.delete("/{project_id}")
async def delete_project(project_id: str, admin: User = Depends(require_admin)):
    project = await Project.get(PydanticObjectId(project_id))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    await project.delete()

    # Unassign endpoints
    await Endpoint.find(Endpoint.project_id == PydanticObjectId(project_id)).update(
        {"$set": {"projectId": None}}
    )

    return {"deleted": True}
