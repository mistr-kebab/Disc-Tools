const { z } = require('zod');

function validate(schema) {
    return (req, res, next) => {
        try {
            req.validated = schema.parse({
                body: req.body,
                query: req.query,
                params: req.params
            });
            next();
        } catch (err) {
            if (err instanceof z.ZodError) {
                const details = err.errors.map(e => ({
                    field: e.path.join('.'),
                    message: e.message
                }));
                return res.status(400).json({
                    error: 'Validation failed',
                    details
                });
            }
            next(err);
        }
    };
}

const userIdSchema = z.string().regex(/^\d{17,20}$/, 'Invalid Discord user ID');

const common = {
    userId: userIdSchema,
    pagination: z.object({
        query: z.object({
            limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().min(1).max(100)).optional(),
            offset: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().min(0)).optional()
        }).partial().optional()
    }).partial().optional()
};

module.exports = { validate, common };
