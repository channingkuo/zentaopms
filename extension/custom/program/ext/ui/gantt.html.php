<?php
namespace zin;
jsVar('programGanttOptions', $ganttOptions);
div(setID('programGantt'), set('aria-label', $lang->program->gantt), $lang->program->ganttLang['loading']);
render();
