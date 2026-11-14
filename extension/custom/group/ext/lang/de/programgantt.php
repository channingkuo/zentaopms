<?php
/* Core removes this resource when programs are disabled or in light mode. */
if(!isset($lang->resource->program) || !is_object($lang->resource->program)) return;

$lang->resource->program->gantt       = 'gantt';
$lang->resource->program->ganttEdit   = 'ganttEdit';
$lang->resource->program->ganttExport = 'ganttExport';
if(!isset($lang->group->package)) $lang->group->package = new stdclass();
$lang->group->package->programGantt = "Program Gantt";
